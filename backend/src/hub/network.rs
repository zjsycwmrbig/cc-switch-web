//! Resolve once and connect to the checked IP, including HTTP CONNECT tunnels.
use super::*;
use std::net::{IpAddr, SocketAddr};
#[derive(Clone)]
pub struct OutboundPolicy {
    pub allow_private: bool,
}
pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let b = ip.octets();
            !(b[0] == 0
                || b[0] == 10
                || b[0] == 127
                || b[0] >= 224
                || (b[0] == 100 && (64..=127).contains(&b[1]))
                || (b[0] == 169 && b[1] == 254)
                || (b[0] == 172 && (16..=31).contains(&b[1]))
                || (b[0] == 192 && (b[1] == 168 || b[1] == 0))
                || (b[0] == 198 && (b[1] == 18 || b[1] == 19)))
        }
        IpAddr::V6(ip) => {
            if let Some(v4) = ip.to_ipv4_mapped() {
                return is_public(IpAddr::V4(v4));
            }
            let b = ip.octets();
            b[0] & 0xe0 == 0x20 && !(b[0] == 0x20 && b[1] == 1 && b[2] == 0x0d && b[3] == 0xb8)
        }
    }
}
pub async fn resolve(host: &str, port: u16) -> Result<Vec<SocketAddr>> {
    let addresses = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        tokio::net::lookup_host((host, port)),
    )
    .await
    .map_err(|_| {
        Error(
            StatusCode::GATEWAY_TIMEOUT,
            "upstream_dns_timeout",
            format!("供应商域名 {host} 解析超时（10 秒），请检查 DNS 或稍后重试"),
        )
    })?
    .map_err(|_| {
        Error(
            StatusCode::BAD_GATEWAY,
            "upstream_dns_failed",
            format!("供应商域名 {host} 解析失败，请检查供应商地址或 DNS 配置"),
        )
    })?
    .collect::<Vec<_>>();
    if addresses.is_empty() || addresses.iter().any(|a| !is_public(a.ip())) {
        return Err(Error::denied(
            "private_upstream_forbidden",
            format!(
                "供应商域名 {host} 解析到了非公网地址；普通用户供应商只允许访问公网，私网资源需由管理员配置"
            ),
        ));
    }
    Ok(addresses)
}
