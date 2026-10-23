//! IPv6 address discovery, filtering, and deterministic selection.

use parking_lot::Mutex;
use std::net::Ipv6Addr;
use std::time::{Duration, Instant};

const CACHE_TTL: Duration = Duration::from_secs(5);
static CACHE: Mutex<Option<(Instant, Option<Ipv6Addr>)>> = Mutex::new(None);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CandidateAddress {
    pub addr: Ipv6Addr,
    pub is_temporary: bool,
    pub is_deprecated: bool,
}

/// Returns whether an IPv6 address is in the eligible global unicast range (2000::/3)
/// excluding special-purpose ranges:
/// - ULA (fc00::/7) - excluded by 2000::/3
/// - Link-local (fe80::/10) - excluded by 2000::/3
/// - Loopback (::1) - excluded by 2000::/3
/// - Documentation (2001:db8::/32)
/// - Teredo (2001::/32)
/// - 6to4 (2002::/16)
pub fn is_eligible_global_unicast(addr: &Ipv6Addr) -> bool {
    let segs = addr.segments();

    // 2000::/3 means the top 3 bits are 001, i.e. 0x2000..=0x3fff.
    if segs[0] & 0xe000 != 0x2000 {
        return false;
    }

    // Documentation 2001:db8::/32
    if segs[0] == 0x2001 && segs[1] == 0x0db8 {
        return false;
    }

    // Teredo tunneling 2001::/32
    if segs[0] == 0x2001 && segs[1] == 0 {
        return false;
    }

    // 6to4 relay 2002::/16
    if segs[0] == 0x2002 {
        return false;
    }

    true
}

/// Deterministically select the best candidate IPv6 address:
/// 1. Excludes non-eligible global unicast addresses.
/// 2. Prefers non-deprecated over deprecated.
/// 3. Prefers non-temporary (stable / "secured") over temporary privacy addresses.
/// 4. Tie-breaks deterministically by address octets.
pub fn select_best_address<I>(candidates: I) -> Option<Ipv6Addr>
where
    I: IntoIterator<Item = CandidateAddress>,
{
    let mut eligible: Vec<CandidateAddress> = candidates
        .into_iter()
        .filter(|c| is_eligible_global_unicast(&c.addr))
        .collect();

    if eligible.is_empty() {
        return None;
    }

    eligible.sort_by(|a, b| {
        a.is_deprecated
            .cmp(&b.is_deprecated)
            .then_with(|| a.is_temporary.cmp(&b.is_temporary))
            .then_with(|| a.addr.octets().cmp(&b.addr.octets()))
    });

    Some(eligible[0].addr)
}

/// Selected global-unicast address (2000::/3) of this machine, if any.
/// Cached for up to 5 seconds to keep polling cheap.
pub fn current_address() -> Option<Ipv6Addr> {
    let mut guard = CACHE.lock();
    if let Some((cached_at, addr)) = *guard {
        if cached_at.elapsed() < CACHE_TTL {
            return addr;
        }
    }

    let candidates = platform_candidates();
    let selected = select_best_address(candidates);
    *guard = Some((Instant::now(), selected));
    selected
}

#[cfg(target_os = "macos")]
fn platform_candidates() -> Vec<CandidateAddress> {
    // macOS ioctl constants from <netinet6/in6_var.h>:
    // SIOCGIFAFLAG_IN6 = _IOWR('i', 73, struct in6_ifreq) = 0xc1206949
    // IN6_IFF_TEMPORARY  = 0x80
    // IN6_IFF_DEPRECATED = 0x10
    const SIOCGIFAFLAG_IN6: libc::c_ulong = 0xc1206949;
    const IN6_IFF_TEMPORARY: libc::c_int = 0x80;
    const IN6_IFF_DEPRECATED: libc::c_int = 0x10;

    #[repr(C)]
    struct In6Ifreq {
        ifr_name: [libc::c_char; libc::IFNAMSIZ],
        ifr_ifru: In6Ifru,
    }

    #[repr(C)]
    union In6Ifru {
        ifru_addr: libc::sockaddr_in6,
        ifru_flags6: libc::c_int,
        padding: [u8; 272],
    }

    let mut result = Vec::new();
    let mut ifap: *mut libc::ifaddrs = std::ptr::null_mut();

    let sock = unsafe { libc::socket(libc::AF_INET6, libc::SOCK_DGRAM, 0) };

    if unsafe { libc::getifaddrs(&mut ifap) } != 0 || ifap.is_null() {
        if sock >= 0 {
            unsafe { libc::close(sock) };
        }
        return fallback_candidates();
    }

    let mut cur = ifap;
    while !cur.is_null() {
        let ifa = unsafe { &*cur };
        cur = ifa.ifa_next;

        if ifa.ifa_addr.is_null() {
            continue;
        }

        // Must be AF_INET6
        if unsafe { (*ifa.ifa_addr).sa_family } != libc::AF_INET6 as libc::sa_family_t {
            continue;
        }

        // Interface must be up and not loopback
        if (ifa.ifa_flags & libc::IFF_UP as u32) == 0
            || (ifa.ifa_flags & libc::IFF_LOOPBACK as u32) != 0
        {
            continue;
        }

        let sin6 = unsafe { &*(ifa.ifa_addr as *const libc::sockaddr_in6) };
        let addr = Ipv6Addr::from(sin6.sin6_addr.s6_addr);

        if !is_eligible_global_unicast(&addr) {
            continue;
        }

        let mut is_temporary = false;
        let mut is_deprecated = false;

        if sock >= 0 {
            let mut req: In6Ifreq = unsafe { std::mem::zeroed() };
            unsafe {
                libc::strncpy(req.ifr_name.as_mut_ptr(), ifa.ifa_name, libc::IFNAMSIZ - 1);
                std::ptr::copy_nonoverlapping(
                    sin6 as *const libc::sockaddr_in6,
                    &mut req.ifr_ifru.ifru_addr,
                    1,
                );
                if libc::ioctl(sock, SIOCGIFAFLAG_IN6, &mut req) == 0 {
                    let flags = req.ifr_ifru.ifru_flags6;
                    is_temporary = (flags & IN6_IFF_TEMPORARY) != 0;
                    is_deprecated = (flags & IN6_IFF_DEPRECATED) != 0;
                }
            }
        }

        result.push(CandidateAddress {
            addr,
            is_temporary,
            is_deprecated,
        });
    }

    unsafe {
        libc::freeifaddrs(ifap);
        if sock >= 0 {
            libc::close(sock);
        }
    }

    if result.is_empty() {
        fallback_candidates()
    } else {
        result
    }
}

#[cfg(not(target_os = "macos"))]
fn platform_candidates() -> Vec<CandidateAddress> {
    fallback_candidates()
}

fn fallback_candidates() -> Vec<CandidateAddress> {
    match local_ip_address::list_afinet_netifas() {
        Ok(interfaces) => interfaces
            .into_iter()
            .filter_map(|(_name, ip)| match ip {
                std::net::IpAddr::V6(v6) => Some(CandidateAddress {
                    addr: v6,
                    is_temporary: false,
                    is_deprecated: false,
                }),
                std::net::IpAddr::V4(_) => None,
            })
            .collect(),
        Err(_) => Vec::new(),
    }
}
