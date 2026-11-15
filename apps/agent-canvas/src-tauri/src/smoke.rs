//! Opt-in live CLI integration harness; never included in release builds.
use super::*;
pub fn run(args: &[String]) {
    let provider = args.get(2).expect("--smoke PROVIDER WORKSPACE REPORT");
    let cwd = args.get(3).expect("workspace");
    let report = PathBuf::from(args.get(4).expect("report"));
    let state = State::default();
    let data = report.with_extension("data");
    persistence::restore(&state, data.join("canvas-state.json")).expect("storage");
    let a=launch(&state,&data,provider.clone(),cwd.clone(),Some("Say CANVAS_ROOT_OK. Use the agent_canvas MCP spawn_agent tool (not a built-in agent tool) for a tiny task: reply CANVAS_CHILD_OK. Use get_thread to wait for its completion and report CANVAS_ROOT_OK again. Do not modify files."),Default::default()).expect("launch");
    persistence::save(&state).expect("checkpoint");
    let s = session(&state, &a.id).unwrap();
    let writer = s.clone();
    std::thread::spawn(move || {
        let mut input = std::io::stdin();
        let mut b = [0; 8192];
        while let Ok(n) = input.read(&mut b) {
            if n == 0 {
                break;
            }
            if let Ok(mut w) = writer.writer.lock() {
                let _ = w.write_all(&b[..n]);
                let _ = w.flush();
            }
        }
    });
    let start = std::time::Instant::now();
    let mut after = 0;
    let mut trusted = false;
    let mut screen = String::new();
    while s.alive.load(Ordering::Acquire) && start.elapsed() < Duration::from_secs(240) {
        if let Ok(o) = s.output.lock() {
            for (_, b) in o.chunks.iter().filter(|(n, _)| *n > after) {
                let _ = std::io::stdout().write_all(b);
                screen.push_str(&String::from_utf8_lossy(b));
            }
            let _ = std::io::stdout().flush();
            after = o.next;
        }
        if !trusted
            && start.elapsed() > Duration::from_secs(6)
            && (screen.contains("Trust this folder?")
                || (screen.contains("workspace:") && screen.contains("Yes,")))
        {
            let input = if provider == "claude" && screen.contains("workspace:") {
                "\x1b[B\r"
            } else {
                "\r"
            };
            let _ = s.writer.lock().unwrap().write_all(input.as_bytes());
            trusted = true;
        }
        let _ = delegation::poll(&state, &data);
        let _ = persistence::save(&state);
        if let Ok(agents) = state.agents.lock() {
            let _ = std::fs::write(
                &report,
                serde_json::to_vec_pretty(&agents.values().collect::<Vec<_>>()).unwrap(),
            );
        }
        if start.elapsed() > Duration::from_secs(10) {
            let agents = state.agents.lock().unwrap();
            let children_exited = state
                .sessions
                .lock()
                .unwrap()
                .iter()
                .all(|(id, s)| id == &a.id || !s.alive.load(Ordering::Acquire));
            if children_exited
                && agents.get(&a.id).is_some_and(|a| a.status == "idle")
                && agents
                    .values()
                    .any(|a| a.parent_id.is_some() && a.has_terminal && a.status == "done")
            {
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    std::thread::sleep(Duration::from_millis(300));
    if let Ok(o) = s.output.lock() {
        for (_, b) in o.chunks.iter().filter(|(n, _)| *n > after) {
            let _ = std::io::stdout().write_all(b);
        }
    }
    if let Ok(agents) = state.agents.lock() {
        let _ = std::fs::write(
            &report,
            serde_json::to_vec_pretty(&agents.values().collect::<Vec<_>>()).unwrap(),
        );
    }
    shutdown(&state).expect("shutdown");
    let processes: Vec<_> = state.sessions.lock().unwrap().iter().map(|(id, s)| serde_json::json!({ "id": id, "pid": s.pid, "alive": s.alive.load(Ordering::Acquire) })).collect();
    let _ = std::fs::write(
        report.with_extension("processes.json"),
        serde_json::to_vec_pretty(&processes).unwrap(),
    );
}
