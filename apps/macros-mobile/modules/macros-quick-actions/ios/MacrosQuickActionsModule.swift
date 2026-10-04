import ExpoModulesCore
import UIKit

/// Holds the action chosen on the Home Screen until JavaScript is listening.
/// A cold launch delivers it from the scene's connection options, long before
/// the bundle has loaded.
final class QuickActionInbox {
  static let shared = QuickActionInbox()

  private var pending: String?
  private var deliver: ((String) -> Void)?

  func receive(_ type: String) {
    if let deliver {
      deliver(type)
    } else {
      pending = type
    }
  }

  func take() -> String? {
    defer { pending = nil }
    return pending
  }

  func listen(_ deliver: ((String) -> Void)?) {
    self.deliver = deliver
  }
}

// ExpoAppSceneDelegate forwards both the cold-start shortcut and one chosen
// while running to app delegate subscribers.
public class MacrosQuickActionsAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    DispatchQueue.main.async {
      QuickActionInbox.shared.receive(shortcutItem.type)
      completionHandler(true)
    }
  }
}

public class MacrosQuickActionsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MacrosQuickActions")

    Events("onAction")

    Function("takePending") { () -> String? in
      QuickActionInbox.shared.take()
    }

    OnStartObserving {
      QuickActionInbox.shared.listen { [weak self] type in
        self?.sendEvent("onAction", ["type": type])
      }
    }

    OnStopObserving {
      QuickActionInbox.shared.listen(nil)
    }
  }
}
