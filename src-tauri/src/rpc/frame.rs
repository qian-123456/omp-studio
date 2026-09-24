//! Protocol v2 `rpc_chunk` reassembly with validation (docs/rpc.md §Transport).
//!
//! Oversized stdout objects arrive as an uninterrupted sequence of `rpc_chunk`
//! frames, each carrying a base64 segment of the original UTF-8 JSON object.

use base64::Engine as _;
use serde_json::Value;

/// Server default `maxReassembledFrameBytes` (64 MiB).
pub const DEFAULT_MAX_REASSEMBLED: usize = 64 * 1024 * 1024;

struct Active {
    chunk_id: String,
    count: usize,
    byte_length: usize,
    chunks: Vec<Option<Vec<u8>>>,
    received: usize,
    bytes: usize,
}

pub struct ChunkReassembler {
    max_reassembled: usize,
    active: Option<Active>,
}

impl Default for ChunkReassembler {
    fn default() -> Self {
        Self::new(DEFAULT_MAX_REASSEMBLED)
    }
}

impl ChunkReassembler {
    pub fn new(max_reassembled: usize) -> Self {
        Self {
            max_reassembled: max_reassembled.max(1),
            active: None,
        }
    }

    /// Adopt the limit advertised by the `ready` frame.
    pub fn set_max_reassembled(&mut self, max: usize) {
        if max > 0 {
            self.max_reassembled = max;
        }
    }

    /// Feed one decoded stdout object.
    /// - `Ok(Some(frame))`: a complete logical frame (plain frame or finished sequence).
    /// - `Ok(None)`: a chunk was consumed; sequence still in progress.
    /// - `Err`: protocol violation; internal state is reset.
    pub fn feed(&mut self, frame: Value) -> Result<Option<Value>, String> {
        if frame.get("type").and_then(Value::as_str) != Some("rpc_chunk") {
            if self.active.is_some() {
                self.active = None;
                return Err("rpc_chunk sequence interrupted by non-chunk frame".into());
            }
            return Ok(Some(frame));
        }

        let chunk_id = frame
            .get("chunkId")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .ok_or("rpc_chunk missing chunkId")?
            .to_string();
        let index = frame
            .get("index")
            .and_then(Value::as_u64)
            .ok_or("rpc_chunk missing index")? as usize;
        let count = frame
            .get("count")
            .and_then(Value::as_u64)
            .ok_or("rpc_chunk missing count")? as usize;
        let byte_length = frame
            .get("byteLength")
            .and_then(Value::as_u64)
            .ok_or("rpc_chunk missing byteLength")? as usize;
        let data = frame
            .get("data")
            .and_then(Value::as_str)
            .ok_or("rpc_chunk missing data")?;

        if count == 0 {
            self.active = None;
            return Err("rpc_chunk count must be >= 1".into());
        }
        if index >= count {
            self.active = None;
            return Err(format!(
                "rpc_chunk index {index} out of range (count {count})"
            ));
        }
        if byte_length > self.max_reassembled {
            self.active = None;
            return Err(format!(
                "rpc_chunk byteLength {byte_length} exceeds reassembly limit {}",
                self.max_reassembled
            ));
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data)
            .map_err(|e| format!("rpc_chunk invalid base64: {e}"))?;

        // Validate against the in-progress sequence first (immutable borrow),
        // then mutate.
        let violation = match self.active.as_ref() {
            None if index != 0 => Some("rpc_chunk sequence must start at index 0".to_string()),
            None => None,
            Some(active) if active.chunk_id != chunk_id => {
                Some("rpc_chunk interleaved chunkId".to_string())
            }
            Some(active) if active.count != count || active.byte_length != byte_length => {
                Some("rpc_chunk count/byteLength changed mid-sequence".to_string())
            }
            Some(active) if index != active.received => Some(format!(
                "rpc_chunk out of order: got index {index}, expected {}",
                active.received
            )),
            Some(_) => None,
        };
        if let Some(err) = violation {
            self.active = None;
            return Err(err);
        }
        if self.active.is_none() {
            let mut chunks = Vec::new();
            chunks.resize_with(count, || None);
            self.active = Some(Active {
                chunk_id,
                count,
                byte_length,
                chunks,
                received: 0,
                bytes: 0,
            });
        }

        let active = self.active.as_mut().expect("active chunk state");
        active.bytes += bytes.len();
        if active.bytes > active.byte_length {
            self.active = None;
            return Err("rpc_chunk payload exceeds byteLength".into());
        }
        active.chunks[index] = Some(bytes);
        active.received += 1;

        if active.received == active.count {
            let done = self.active.take().expect("active chunk state");
            if done.bytes != done.byte_length {
                return Err(format!(
                    "rpc_chunk reassembled {} bytes, expected {}",
                    done.bytes, done.byte_length
                ));
            }
            let mut buf = Vec::with_capacity(done.byte_length);
            for chunk in done.chunks.into_iter().flatten() {
                buf.extend_from_slice(&chunk);
            }
            let text = String::from_utf8(buf)
                .map_err(|_| "rpc_chunk payload is not valid UTF-8".to_string())?;
            let value = serde_json::from_str(&text)
                .map_err(|e| format!("rpc_chunk payload is not valid JSON: {e}"))?;
            return Ok(Some(value));
        }
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn chunk(chunk_id: &str, index: u64, count: u64, byte_length: u64, data: &str) -> Value {
        json!({
            "type": "rpc_chunk",
            "chunkId": chunk_id,
            "index": index,
            "count": count,
            "byteLength": byte_length,
            "data": base64::engine::general_purpose::STANDARD.encode(data),
        })
    }

    fn split_frame(payload: &Value, parts: usize) -> Vec<Value> {
        let text = payload.to_string();
        let byte_length = text.len() as u64;
        let chunk_size = text.len().div_ceil(parts).max(1);
        text.as_bytes()
            .chunks(chunk_size)
            .enumerate()
            .map(|(i, part)| {
                chunk(
                    "rpc-1",
                    i as u64,
                    parts as u64,
                    byte_length,
                    std::str::from_utf8(part).unwrap(),
                )
            })
            .collect()
    }

    #[test]
    fn passthrough_plain_frame() {
        let mut r = ChunkReassembler::default();
        let frame = json!({"type": "agent_start"});
        assert_eq!(r.feed(frame.clone()).unwrap(), Some(frame));
    }

    #[test]
    fn reassembles_multi_chunk_frame() {
        let mut r = ChunkReassembler::default();
        let payload = json!({"type": "response", "id": "req_1", "success": true, "data": {"big": "x".repeat(5000)}});
        let chunks = split_frame(&payload, 7);
        let mut out = None;
        for c in chunks {
            out = r.feed(c).unwrap();
        }
        assert_eq!(out, Some(payload));
    }

    #[test]
    fn single_chunk_frame() {
        let mut r = ChunkReassembler::default();
        let payload = json!({"type": "response", "ok": true});
        let chunks = split_frame(&payload, 1);
        assert_eq!(r.feed(chunks[0].clone()).unwrap(), Some(payload));
    }

    #[test]
    fn rejects_interleaved_chunk_id() {
        let mut r = ChunkReassembler::default();
        let payload = json!({"a": 1});
        let mut chunks = split_frame(&payload, 3);
        // Second chunk carries a different chunkId.
        chunks[1]["chunkId"] = json!("rpc-other");
        assert!(r.feed(chunks[0].clone()).unwrap().is_none());
        assert!(r.feed(chunks[1].clone()).is_err());
    }

    #[test]
    fn rejects_out_of_order_index() {
        let mut r = ChunkReassembler::default();
        let payload = json!({"a": "b".repeat(100)});
        let chunks = split_frame(&payload, 3);
        assert!(r.feed(chunks[0].clone()).unwrap().is_none());
        // Skip index 1.
        assert!(r.feed(chunks[2].clone()).is_err());
    }

    #[test]
    fn rejects_sequence_not_starting_at_zero() {
        let mut r = ChunkReassembler::default();
        let payload = json!({"a": "b".repeat(100)});
        let chunks = split_frame(&payload, 3);
        assert!(r.feed(chunks[1].clone()).is_err());
    }

    #[test]
    fn rejects_non_chunk_frame_mid_sequence() {
        let mut r = ChunkReassembler::default();
        let payload = json!({"a": "b".repeat(100)});
        let chunks = split_frame(&payload, 3);
        assert!(r.feed(chunks[0].clone()).unwrap().is_none());
        assert!(r.feed(json!({"type": "agent_start"})).is_err());
        // Recovers afterwards.
        assert_eq!(
            r.feed(json!({"type": "agent_end"})).unwrap(),
            Some(json!({"type": "agent_end"}))
        );
    }

    #[test]
    fn enforces_reassembly_limit() {
        let mut r = ChunkReassembler::new(64);
        let payload = json!({"big": "x".repeat(1000)});
        let chunks = split_frame(&payload, 4);
        assert!(r.feed(chunks[0].clone()).is_err());
    }

    #[test]
    fn rejects_bad_base64_and_bad_json() {
        let mut r = ChunkReassembler::default();
        let bad = json!({"type":"rpc_chunk","chunkId":"x","index":0,"count":1,"byteLength":4,"data":"!!!"});
        assert!(r.feed(bad).is_err());

        // Valid base64, invalid JSON payload.
        let mut r = ChunkReassembler::default();
        let not_json = chunk("x", 0, 1, 5, "nope!");
        assert!(r.feed(not_json).is_err());
    }

    #[test]
    fn rejects_byte_length_mismatch() {
        let mut r = ChunkReassembler::default();
        // Declares 4 bytes, delivers 2.
        let c = chunk("x", 0, 1, 4, "{}");
        assert!(r.feed(c).is_err());
    }
}
