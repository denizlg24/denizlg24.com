Pod::Spec.new do |s|
  s.name           = 'VoiceNative'
  s.version        = '1.0.0'
  s.summary        = 'Live Activity, widgets and background time for Voice'
  s.description    = 'Live Activity, widgets and background time for Voice'
  s.author         = ''
  s.homepage       = 'https://denizlg24.com'
  s.license        = { type: 'UNLICENSED' }
  s.platforms      = { :ios => '18.0' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WidgetKit', 'ActivityKit'

  # Intents/ is compiled into the app target and the extension, never here.
  s.source_files = 'VoiceNativeModule.swift', 'Shared/*.swift'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
