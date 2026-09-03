SELECT format(
  $query$
  SELECT json_build_object(
    'database', %L,
    'deployments', coalesce(
      json_agg(row_to_json(inventory) ORDER BY inventory."deploymentId"),
      '[]'::json
    )
  )::text
  FROM (
    SELECT
      deployment.id::text AS "deploymentId",
      deployment.image_tag AS "imageReference",
      deployment.image_digest AS "imageDigest",
      (
        SELECT domain.hostname
        FROM public.deploy_domains domain
        WHERE domain.target_id = deployment.target_id
          AND domain.is_primary = true
        LIMIT 1
      ) AS hostname
    FROM public.deployments deployment
    WHERE deployment.kind::text = 'production'
      AND deployment.status::text = 'ready'
  ) inventory;
  $query$,
  :'database'
)
WHERE to_regclass('public.deployments') IS NOT NULL
  AND to_regclass('public.deploy_domains') IS NOT NULL
\gexec
