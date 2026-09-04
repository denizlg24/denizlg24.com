. as $state |
($domains | length) > 0 and
all(
  $domains[];
  . as $domain |
  any(
    $state.records[];
    (.publicHostnames | index($domain)) and
    .kind == "tunnel" and
    (.profiles | index("forge"))
  ) and
  any(
    $state.healthUrls[];
    (.profiles | index("forge")) and
    (
      .url == ("https://" + $domain) or
      (.url | startswith("https://" + $domain + "/"))
    )
  )
)
