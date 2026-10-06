Pod::Spec.new do |s|
  s.name           = 'MacrosWidgets'
  s.version        = '1.0.0'
  s.summary        = 'Home Screen widget data for Macros'
  s.description    = 'Home Screen widget data for Macros'
  s.author         = ''
  s.homepage       = 'https://macros.denizlg24.com'
  s.license        = { type: 'UNLICENSED' }
  s.platforms      = { :ios => '17.0' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WidgetKit'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
