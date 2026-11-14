//! Opt-in live CLI integration harness; never included in release builds.
use super::*;
pub fn run(args: &[String]) {
    let provider = args.get(2).expect("--smoke PROVIDER WORKSPACE REPORT");
    let cwd = args.get(3).expect("workspace");
    let report = PathBuf::from(args.get(4).expect("report"));
    let state = State::default();
    let data = report.with_extension("data");
    let a=launch(&state,&data,provider.clone(),cwd.clone(),Some("Say CANVAS_ROOT_OK. Use one subagent for a tiny task: reply CANVAS_CHILD_OK. Wait for it and finish. Do not modify files."),Default::default()).expect("launch");
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
        if let Ok(agents) = state.agents.lock() {
            let _ = std::fs::write(
                &report,
                serde_json::to_vec_pretty(&agents.values().collect::<Vec<_>>()).unwrap(),
            );
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    let _ = s.terminate();
}
