use anyhow::Ok;
use console::style;

use crate::utils::{
    manifest::{load_manifest, save_manifest},
    paths::{to_native_path, validate_project_path},
    ui::{print_error, print_info, print_success},
};

pub fn remove_file(path: &str, cached: bool) -> anyhow::Result<()> {
    let mut manifest = load_manifest()?;
    let normalized = validate_project_path(path)?;

    if !manifest.files.contains_key(&normalized) {
        print_error(&format!("File '{}' is not tracked.", path));
        return Ok(());
    }

    manifest.files.remove(&normalized);
    manifest.upgrade();
    save_manifest(&manifest)?;

    if !cached {
        let working_path = to_native_path(&normalized);
        if working_path.exists() {
            std::fs::remove_file(&working_path).map_err(|error| {
                anyhow::anyhow!(
                    "Stopped tracking '{}', but failed to delete the working file: {}",
                    normalized,
                    error
                )
            })?;
        }
    }

    if cached {
        print_success(&format!("Stopped tracking '{}'.", normalized));
    } else {
        print_success(&format!("Removed '{}'.", normalized));
    }
    print_info(&format!(
        "Run {} to record this change.",
        style("`envy commit -m \"message\"`").cyan()
    ));
    Ok(())
}
