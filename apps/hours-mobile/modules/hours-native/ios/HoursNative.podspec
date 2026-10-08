Pod::Spec.new do |s|
  s.name           = 'HoursNative'
  s.version        = '1.0.0'
  s.summary        = 'Session, widgets and Live Activity bridge for Hours'
  s.description    = 'Session, widgets and Live Activity bridge for Hours'
  s.author         = ''
  s.homepage       = 'https://denizlg24.com'
  s.license        = { type: 'UNLICENSED' }
  s.platforms      = { :ios => '18.0' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WidgetKit', 'ActivityKit', 'Security'

  # Intents/ is compiled into the app target and the widget extension by the
  # config plugin, never into this pod.
  s.source_files = 'HoursNativeModule.swift', 'DeviceRegistrar.swift', 'Shared/*.swift'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
