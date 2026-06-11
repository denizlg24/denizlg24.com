import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      },
      body: JSON.stringify({
        query: `
          query ($username: String!) {
            user(login: $username) {
              repositories(
                first: 10
                orderBy: { field: PUSHED_AT, direction: DESC }
                ownerAffiliations: OWNER
              ) {
                nodes {
                  name
                  defaultBranchRef {
                    target {
                      ... on Commit {
                        history(first: 3) {
                          nodes {
                            oid
                            messageHeadline
                            committedDate
                            url
                            author {
                              user {
                                login
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `,
        variables: { username: "denizlg24" },
      }),
    });

    const json = await result.json();
    const repos = json.data.user.repositories.nodes;

    const commits: {
      oid: string;
      messageHeadline: string;
      committedDate: string;
      url: string;
      repoName: string;
    }[] = [];

    for (const repo of repos) {
      if (!repo.defaultBranchRef?.target?.history?.nodes) continue;
      for (const commit of repo.defaultBranchRef.target.history.nodes) {
        if (commit.author?.user?.login !== "denizlg24") continue;
        commits.push({
          oid: commit.oid,
          messageHeadline: commit.messageHeadline,
          committedDate: commit.committedDate,
          url: commit.url,
          repoName: repo.name,
        });
      }
    }

    commits.sort(
      (a, b) =>
        new Date(b.committedDate).getTime() -
        new Date(a.committedDate).getTime(),
    );

    return NextResponse.json(commits.slice(0, 10));
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch commits" },
      { status: 500 },
    );
  }
}
