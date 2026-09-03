.server_types
| map(select(.name == $serverType))
| if length != 1 then error("Hetzner did not return exactly one requested server type") else .[0] end
| . as $type
| [$type.prices[] | select(.location == $region)] as $prices
| [$type.locations[] | select(.name == $region)] as $locations
| if ($locations | length) != 1 then error("Hetzner server type is not supported in the requested location")
  elif $locations[0].deprecation != null then error("Hetzner server type is deprecated in the requested location")
  elif $locations[0].available != true then error("Hetzner server type is currently unavailable in the requested location")
  elif $type.architecture != "x86" then error("Hetzner server type is not x86_64")
  elif ($type.cores | type) != "number" or $type.cores < 8 then error("Hetzner server type has fewer than 8 vCPU")
  elif ($type.memory | type) != "number" or $type.memory < 16 then error("Hetzner server type has less than 16 GB RAM")
  elif ($type.disk | type) != "number" or ($type.disk * 1000000000) < $requiredDiskBytes then error("Hetzner server type is below the signed recovery disk requirement")
  elif ($prices | length) != 1 then error("Hetzner returned no unique price for the requested location")
  else {
    serverType: $type.name,
    architecture: $type.architecture,
    cores: $type.cores,
    memoryBytes: (($type.memory * 1000000000) | floor),
    diskBytes: (($type.disk * 1000000000) | floor),
    locationAvailable: $locations[0].available,
    locationRecommended: $locations[0].recommended,
    hourlyGrossEur: $prices[0].price_hourly.gross
  }
  end
