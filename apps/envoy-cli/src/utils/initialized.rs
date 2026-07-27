use std::path::Path;
pub fn check_initialized() -> anyhow::Result<()> {
    if !Path::new(".envoy").exists() {
        anyhow::bail!("Not an Envoy project. Run `envy init` first.");
    }
    Ok(())
}
