//! Skills and extensions catalog and reader.
//!
//! Scans ~/.omp/agent/skills, ~/.agents/skills, project .omp/skills, etc.
//! Parses frontmatter (name/description) cheaply without loading entire files.
//! Enforces path restriction on skills_read so arbitrary files cannot be traversed.

pub mod commands;
pub mod usage;

#[cfg(test)]
mod tests;
