mod agent_config;
mod ai_usage;
mod project_instructions;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

static SYNC_PAUSED: AtomicBool = AtomicBool::new(false);

fn toggle_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
}

pub fn run() {
    // TODO: tornar o atalho configurável (hoje fixo em Ctrl+Shift+Espaço).
    let toggle = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);

    tauri::Builder::default()
        // Precisa ser o primeiro plugin: abrir o Cooper de novo só mostra a janela que já existe.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &toggle && event.state() == ShortcutState::Pressed {
                        toggle_main(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            agent_config::connect_agent,
            ai_usage::read_ai_usage,
            project_instructions::preview_agent_instructions,
            project_instructions::write_agent_instructions
        ])
        .setup(move |app| {
            // Atalho ocupado (outro app, ou outra cópia do Cooper) não pode impedir o app de abrir.
            if let Err(e) = app.global_shortcut().register(toggle) {
                eprintln!("[cooper] atalho Ctrl+Shift+Espaço indisponível: {e}");
            }

            let show = MenuItem::with_id(app, "toggle", "Mostrar/ocultar", true, None::<&str>)?;
            let pause = MenuItem::with_id(app, "pause", "Pausar sincronização", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &pause, &quit])?;
            let pause_item = pause.clone();

            TrayIconBuilder::with_id("cooper")
                .icon(app.default_window_icon().cloned().expect("ícone padrão ausente"))
                .tooltip("Cooper")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "toggle" => toggle_main(app),
                    "pause" => {
                        let paused = !SYNC_PAUSED.fetch_xor(true, Ordering::SeqCst);
                        let _ = pause_item.set_text(if paused { "Retomar sincronização" } else { "Pausar sincronização" });
                        let _ = app.emit("sync-paused", paused);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        toggle_main(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Cooper");
}
