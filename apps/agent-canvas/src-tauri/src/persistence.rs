use super::*;

#[derive(Serialize, Deserialize)]
struct SavedCanvas {
    version: u32,
    agents: HashMap<String, Agent>,
    terminals: HashMap<String, Output>,
}

pub fn save(state: &State) -> Result<(), String> {
    // Serialize checkpoints, including stop/create, so an older checkpoint
    // can never overwrite a newer one.
    let _checkpoint = state.checkpoint.lock().map_err(err)?;
    let Some(path) = state.storage.lock().map_err(err)?.clone() else {
        return Ok(());
    };
    let agents = state.agents.lock().map_err(err)?.clone();
    let mut terminals = state.archived.lock().map_err(err)?.clone();
    for (id, session) in state.sessions.lock().map_err(err)?.iter() {
        if agents.contains_key(id) {
            terminals.insert(id.clone(), session.output.lock().map_err(err)?.clone());
        }
    }
    let bytes = serde_json::to_vec(&SavedCanvas {
        version: 1,
        agents,
        terminals,
    })
    .map_err(err)?;
    let parent = path.parent().ok_or("Invalid canvas storage path")?;
    std::fs::create_dir_all(parent).map_err(err)?;
    let temporary = path.with_extension("tmp");
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&temporary)
        .map_err(err)?;
    file.write_all(&bytes).map_err(err)?;
    file.sync_all().map_err(err)?;
    std::fs::rename(temporary, path).map_err(err)
}

// A running CLI must always retain its launch identity, even if disk storage
// fails. Callers can report the warning without inviting a duplicate retry.
pub fn checkpoint_launch(state: &State, mut agent: Agent) -> Agent {
    if let Err(error) = save(state) {
        let warning =
            format!("CLI started, but its initial checkpoint could not be saved: {error}");
        agent.checkpoint_warning = Some(warning.clone());
        if let Ok(mut agents) = state.agents.lock() {
            if let Some(registered) = agents.get_mut(&agent.id) {
                registered.checkpoint_warning = Some(warning);
            }
        }
    }
    agent
}

pub fn restore(state: &State, path: PathBuf) -> Result<(), String> {
    let saved = match std::fs::read(&path) {
        Ok(bytes) => Some(
            serde_json::from_slice::<SavedCanvas>(&bytes)
                .map_err(|e| format!("Cannot read saved canvas {}: {e}", path.display()))?,
        ),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(err(e)),
    };
    if let Some(mut saved) = saved {
        if saved.version != 1 {
            return Err("Unsupported saved canvas version".into());
        }
        for agent in saved.agents.values_mut() {
            if agent.parent_id.is_none() {
                agent.has_terminal = true;
            }
            if !["done", "stopped", "error"].contains(&agent.status.as_str()) {
                agent.status = "stopped".into();
                agent.activity = "Saved session · CLI stopped when app closed".into();
            }
        }
        *state.agents.lock().map_err(err)? = saved.agents;
        *state.archived.lock().map_err(err)? = saved.terminals;
    }
    *state.storage.lock().map_err(err)? = Some(path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_checkpoint_preserves_successful_launch_identity() {
        let dir = std::env::temp_dir().join(format!("canvas-save-failure-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let blocker = dir.join("not-a-directory");
        std::fs::write(&blocker, "block checkpoint").unwrap();
        let state = State::default();
        *state.storage.lock().unwrap() = Some(blocker.join("state.json"));
        let agent = Agent::root("launched", "codex", "/tmp");
        state
            .agents
            .lock()
            .unwrap()
            .insert(agent.id.clone(), agent.clone());
        let result = checkpoint_launch(&state, agent);
        assert_eq!(result.id, "launched");
        assert_eq!(result.status, "starting");
        assert!(result.checkpoint_warning.is_some());
        assert_eq!(
            state.agents.lock().unwrap()["launched"].checkpoint_warning,
            result.checkpoint_warning
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn restart_restores_children_usage_and_terminal_cursor_without_live_processes() {
        let dir = std::env::temp_dir().join(format!("canvas-{}", Uuid::new_v4()));
        let path = dir.join("state.json");
        let state = State::default();
        restore(&state, path.clone()).unwrap();
        let mut root = Agent::root("root", "codex", "/tmp");
        root.input_tokens = Some(123);
        let mut child = root.clone();
        child.id = "child".into();
        child.parent_id = Some("root".into());
        child.status = "done".into();
        state
            .agents
            .lock()
            .unwrap()
            .extend([("root".into(), root), ("child".into(), child)]);
        let mut output = Output::default();
        output.push(b"screen\r\n".to_vec());
        state.archived.lock().unwrap().insert("root".into(), output);
        save(&state).unwrap();
        let restored = State::default();
        restore(&restored, path).unwrap();
        let agents = restored.agents.lock().unwrap();
        assert_eq!(agents["root"].status, "stopped");
        assert_eq!(agents["root"].input_tokens, Some(123));
        assert_eq!(agents["child"].status, "done");
        assert_eq!(agents["child"].parent_id.as_deref(), Some("root"));
        assert!(restored.sessions.lock().unwrap().is_empty());
        let output = restored.archived.lock().unwrap();
        assert_eq!(output["root"].next, 1);
        assert_eq!(output["root"].chunks[0].1, b"screen\r\n");
        drop(output);
        drop(agents);
        forget_root(&restored, "root").unwrap();
        save(&restored).unwrap();
        let again = State::default();
        restore(&again, dir.join("state.json")).unwrap();
        assert!(again.agents.lock().unwrap().is_empty());
        assert!(again.archived.lock().unwrap().is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
