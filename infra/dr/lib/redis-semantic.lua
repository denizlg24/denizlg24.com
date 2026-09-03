local time = redis.call('TIME')
local capturedAtMs = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local keys = redis.call('KEYS', '*')
local entries = {}

for _, key in ipairs(keys) do
  local dump = redis.call('DUMP', key)
  if dump then
    local expiresAtMs = redis.call('PEXPIRETIME', key)
    table.insert(entries, {
      keySha1 = redis.sha1hex(key),
      type = redis.call('TYPE', key).ok,
      valueSha1 = redis.sha1hex(dump),
      expiresAtMs = expiresAtMs >= 0 and expiresAtMs or cjson.null
    })
  end
end

table.sort(entries, function(a, b) return a.keySha1 < b.keySha1 end)
return cjson.encode({capturedAtMs = capturedAtMs, keys = #entries, entries = entries})
