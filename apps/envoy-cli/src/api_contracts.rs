use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub(crate) struct DeviceCodeResponse {
    pub(crate) device_code: String,
    pub(crate) user_code: String,
    pub(crate) verification_uri: String,
    pub(crate) interval: u64,
    pub(crate) expires_in: u64,
}

#[derive(Deserialize)]
#[serde(untagged)]
pub(crate) enum TokenResponse {
    Success {
        #[serde(rename = "apiToken")]
        api_token: String,
    },
    Pending {
        error: String,
    },
}

#[derive(Serialize)]
pub(crate) struct GithubTokenRequest<'a> {
    pub(crate) device_code: &'a str,
}

#[derive(Deserialize)]
pub(crate) struct CreateProjectResponse {
    #[serde(rename = "projectId")]
    pub(crate) project_id: String,
}

#[derive(Deserialize)]
pub(crate) struct SignedUrlResponse {
    pub(crate) method: String,
    pub(crate) url: String,
}

#[derive(Deserialize)]
pub(crate) struct HeadResponse {
    pub(crate) head: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct UpdateHeadRequest<'a> {
    pub(crate) new_head: &'a str,
    pub(crate) expected_head: Option<&'a str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BlobAccessRequest<'a> {
    pub(crate) member_ids: Option<&'a [String]>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AddMemberRequest<'a> {
    pub(crate) github_id: String,
    pub(crate) nickname: &'a str,
}

#[derive(Deserialize)]
pub(crate) struct ProjectMemberResponse {
    #[serde(rename = "projectMember")]
    pub(crate) project_member: ProjectMember,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectMember {
    pub(crate) user_id: String,
    #[allow(dead_code)]
    pub(crate) project_id: String,
    pub(crate) role: String,
    pub(crate) nickname: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct ListMembersResponse {
    pub(crate) members: Vec<ProjectMember>,
}

#[derive(Deserialize)]
pub(crate) struct RemoveMemberResponse {
    #[allow(dead_code)]
    pub(crate) success: bool,
    #[serde(rename = "deletedMember")]
    pub(crate) deleted_member: ProjectMember,
}

#[derive(Deserialize)]
pub(crate) struct RemoveAllMembersResponse {
    #[allow(dead_code)]
    pub(crate) success: bool,
    #[serde(rename = "deletedCount")]
    pub(crate) deleted_count: u32,
}

#[cfg(test)]
mod tests {
    use serde::de::DeserializeOwned;
    use serde_json::Value;

    use super::*;

    fn fixtures() -> Value {
        serde_json::from_str(include_str!("../contracts/v1/fixtures.json")).unwrap()
    }

    fn parse_fixture<T: DeserializeOwned>(fixtures: &Value, name: &str) {
        serde_json::from_value::<T>(fixtures[name].clone()).unwrap();
    }

    #[test]
    fn response_fixtures_match_cli_wire_types() {
        let fixtures = fixtures();

        parse_fixture::<DeviceCodeResponse>(&fixtures, "deviceCodeResponse");
        parse_fixture::<TokenResponse>(&fixtures, "authTokenSuccess");
        parse_fixture::<TokenResponse>(&fixtures, "authTokenPending");
        parse_fixture::<CreateProjectResponse>(&fixtures, "createProjectResponse");
        parse_fixture::<SignedUrlResponse>(&fixtures, "signedUploadUrlResponse");
        parse_fixture::<SignedUrlResponse>(&fixtures, "signedDownloadUrlResponse");
        parse_fixture::<HeadResponse>(&fixtures, "headResponse");
        parse_fixture::<ProjectMemberResponse>(&fixtures, "addMemberResponse");
        parse_fixture::<ListMembersResponse>(&fixtures, "listMembersResponse");
        parse_fixture::<RemoveMemberResponse>(&fixtures, "removeMemberResponse");
        parse_fixture::<RemoveAllMembersResponse>(&fixtures, "removeAllMembersResponse");
    }

    #[test]
    fn request_fixtures_match_cli_serialization() {
        let fixtures = fixtures();

        assert_eq!(
            serde_json::to_value(GithubTokenRequest {
                device_code: "device-code",
            })
            .unwrap(),
            fixtures["githubTokenRequest"]
        );
        assert_eq!(
            serde_json::to_value(UpdateHeadRequest {
                new_head: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                expected_head: Some(
                    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                ),
            })
            .unwrap(),
            fixtures["updateHeadRequest"]
        );
        assert_eq!(
            serde_json::to_value(BlobAccessRequest {
                member_ids: Some(&["e7e5a675-0d31-4d1e-a9cd-fcaed1d5f7c4".to_string(),]),
            })
            .unwrap(),
            fixtures["blobAccessRequest"]
        );
        assert_eq!(
            serde_json::to_value(AddMemberRequest {
                github_id: "12345678".to_string(),
                nickname: "release-bot",
            })
            .unwrap(),
            fixtures["addMemberRequest"]
        );
    }
}
