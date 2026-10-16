Pod::Spec.new do |s|
  s.name           = 'LocationNative'
  s.version        = '1.0.0'
  s.summary        = 'Background location capture and upload for Location'
  s.description    = 'Background location capture and upload for Location'
  s.author         = ''
  s.homepage       = 'https://denizlg24.com'
  s.license        = { type: 'UNLICENSED' }
  s.platforms      = { :ios => '18.0' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CoreLocation', 'MapKit', 'Security'

  s.source_files = '*.swift'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
