Pod::Spec.new do |s|
  s.name           = 'DashboardNative'
  s.version        = '1.0.0'
  s.summary        = 'Session, widgets and Spotlight bridge for Dashboard'
  s.description    = 'Session, widgets and Spotlight bridge for Dashboard'
  s.author         = ''
  s.homepage       = 'https://denizlg24.com'
  s.license        = { type: 'UNLICENSED' }
  s.platforms      = { :ios => '18.0' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WidgetKit', 'CoreSpotlight', 'Security'

  # Intents/ is compiled into the app target and the widget extension by the
  # config plugin, never into this pod.
  s.source_files = 'DashboardNativeModule.swift', 'DashboardAppDelegate.swift', 'Spotlight.swift', 'Shared/*.swift'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
