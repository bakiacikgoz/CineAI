use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

const FAL_ALIAS_URL: &str = "https://api.fal.ai/v1/serverless/endpoints/aliases";
const FAL_STORAGE_INITIATE_URL: &str =
    "https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3";
const FAL_QUEUE_BASE_URL: &str = "https://queue.fal.run";
const REQUEST_ID_HEADER: &str = "x-fal-request-id";
const ENDPOINT_NAMESPACES: [&str; 2] = ["workflows", "comfy"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FalAliasSummary {
    alias_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FalQueueSubmitResponse {
    request_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FalQueueStatusResponse {
    status: String,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FalQueueResultResponse {
    request_id: Option<String>,
    data: Value,
}

#[derive(Deserialize)]
struct FalUploadInitResponse {
    upload_url: String,
    file_url: String,
}

#[derive(Deserialize)]
struct FalQueueSubmitRaw {
    request_id: String,
}

struct ParsedEndpointId {
    namespace: Option<String>,
    owner: String,
    alias: String,
    path: Option<String>,
}

fn fal_client() -> Result<Client, String> {
    Client::builder()
        .user_agent("CineAI Studio")
        .build()
        .map_err(|error| format!("HTTP istemcisi hazirlanamadi: {error}"))
}

fn normalize_authorization(api_key: &str) -> String {
    let trimmed = api_key.trim();

    if trimmed.to_ascii_lowercase().starts_with("key ") {
        trimmed.to_string()
    } else {
        format!("Key {trimmed}")
    }
}

fn infer_content_type(file_path: &str) -> &'static str {
    match Path::new(file_path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("mp4") => "video/mp4",
        _ => "application/octet-stream",
    }
}

fn parse_endpoint_id(endpoint_id: &str) -> Result<ParsedEndpointId, String> {
    let normalized = endpoint_id.trim().trim_matches('/');
    let parts = normalized
        .split('/')
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>();

    if parts.len() < 2 {
        return Err(format!("Gecersiz FAL endpoint kimligi: {endpoint_id}"));
    }

    if ENDPOINT_NAMESPACES.contains(&parts[0]) {
        if parts.len() < 3 {
            return Err(format!("Gecersiz FAL endpoint kimligi: {endpoint_id}"));
        }

        return Ok(ParsedEndpointId {
            namespace: Some(parts[0].to_string()),
            owner: parts[1].to_string(),
            alias: parts[2].to_string(),
            path: if parts.len() > 3 {
                Some(parts[3..].join("/"))
            } else {
                None
            },
        });
    }

    Ok(ParsedEndpointId {
        namespace: None,
        owner: parts[0].to_string(),
        alias: parts[1].to_string(),
        path: if parts.len() > 2 {
            Some(parts[2..].join("/"))
        } else {
            None
        },
    })
}

fn normalize_submit_endpoint_id(endpoint_id: &str) -> Result<String, String> {
    let parsed = parse_endpoint_id(endpoint_id)?;
    let mut parts = Vec::new();

    if let Some(namespace) = parsed.namespace {
        parts.push(namespace);
    }

    parts.push(parsed.owner);
    parts.push(parsed.alias);

    if let Some(path) = parsed.path {
        parts.push(path);
    }

    Ok(parts.join("/"))
}

fn normalize_queue_endpoint_id(endpoint_id: &str) -> Result<String, String> {
    let parsed = parse_endpoint_id(endpoint_id)?;
    let mut parts = Vec::new();

    if let Some(namespace) = parsed.namespace {
        parts.push(namespace);
    }

    parts.push(parsed.owner);
    parts.push(parsed.alias);

    Ok(parts.join("/"))
}

async fn response_error(operation: &str, response: reqwest::Response) -> String {
    let status = response.status();
    let body = response
        .text()
        .await
        .unwrap_or_default()
        .trim()
        .to_string();

    if body.is_empty() {
        format!("{operation} basarisiz oldu ({status}).")
    } else {
        let shortened = if body.chars().count() > 500 {
            format!("{}...", body.chars().take(500).collect::<String>())
        } else {
            body
        };
        format!("{operation} basarisiz oldu ({status}): {shortened}")
    }
}

fn extract_error_message(payload: &Value) -> Option<String> {
    for key in ["error", "message", "detail"] {
        let Some(candidate) = payload.get(key) else {
            continue;
        };

        if let Some(text) = candidate.as_str() {
            let trimmed = text.trim();

            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }

        if let Some(object) = candidate.as_object() {
            for nested_key in ["message", "detail"] {
                if let Some(text) = object.get(nested_key).and_then(|value| value.as_str()) {
                    let trimmed = text.trim();

                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                }
            }
        }
    }

    None
}

#[tauri::command]
pub async fn fal_test_connection(api_key: String) -> Result<FalAliasSummary, String> {
    let client = fal_client()?;

    for authorization in [api_key.trim().to_string(), normalize_authorization(&api_key)] {
        let response = client
            .get(FAL_ALIAS_URL)
            .header("Authorization", authorization)
            .send()
            .await
            .map_err(|error| format!("FAL baglanti testi basarisiz oldu: {error}"))?;

        if response.status().is_success() {
            let payload: Value = response
                .json()
                .await
                .map_err(|error| format!("FAL alias listesi parse edilemedi: {error}"))?;
            let alias_count = payload
                .get("aliases")
                .and_then(|value| value.as_array())
                .or_else(|| payload.get("data").and_then(|value| value.as_array()))
                .or_else(|| payload.get("items").and_then(|value| value.as_array()))
                .map(|entries| entries.len())
                .unwrap_or(0);

            return Ok(FalAliasSummary { alias_count });
        }

        if !matches!(
            response.status(),
            reqwest::StatusCode::UNAUTHORIZED | reqwest::StatusCode::FORBIDDEN
        ) {
            return Err(response_error("FAL baglanti testi", response).await);
        }
    }

    Err("FAL anahtari dogrulanamadi.".to_string())
}

#[tauri::command]
pub async fn fal_upload_file(api_key: String, file_path: String) -> Result<String, String> {
    let client = fal_client()?;
    let bytes = tokio::fs::read(&file_path)
        .await
        .map_err(|error| format!("Dosya okunamadi: {error}"))?;
    let content_type = infer_content_type(&file_path);
    let file_name = Path::new(&file_path)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("cineai-upload.bin")
        .to_string();

    let response = client
        .post(FAL_STORAGE_INITIATE_URL)
        .header("Authorization", normalize_authorization(&api_key))
        .json(&serde_json::json!({
            "content_type": content_type,
            "file_name": file_name,
        }))
        .send()
        .await
        .map_err(|error| format!("FAL upload baslatilamadi: {error}"))?;

    if !response.status().is_success() {
        return Err(response_error("FAL upload baslatma istegi", response).await);
    }

    let initiate: FalUploadInitResponse = response
        .json()
        .await
        .map_err(|error| format!("FAL upload yaniti parse edilemedi: {error}"))?;

    let upload_response = client
        .put(&initiate.upload_url)
        .header("Content-Type", content_type)
        .body(bytes)
        .send()
        .await
        .map_err(|error| format!("Dosya FAL depolamaya yuklenemedi: {error}"))?;

    if !upload_response.status().is_success() {
        return Err(response_error("FAL dosya yukleme istegi", upload_response).await);
    }

    Ok(initiate.file_url)
}

#[tauri::command]
pub async fn fal_queue_submit(
    api_key: String,
    endpoint_id: String,
    input: Value,
) -> Result<FalQueueSubmitResponse, String> {
    let client = fal_client()?;
    let submit_endpoint_id = normalize_submit_endpoint_id(&endpoint_id)?;
    let response = client
        .post(format!("{FAL_QUEUE_BASE_URL}/{submit_endpoint_id}"))
        .header("Authorization", normalize_authorization(&api_key))
        .json(&input)
        .send()
        .await
        .map_err(|error| format!("Fal queue submit basarisiz oldu: {error}"))?;

    if !response.status().is_success() {
        return Err(response_error("Fal queue submit istegi", response).await);
    }

    let payload: FalQueueSubmitRaw = response
        .json()
        .await
        .map_err(|error| format!("Fal queue submit yaniti parse edilemedi: {error}"))?;

    Ok(FalQueueSubmitResponse {
        request_id: payload.request_id,
    })
}

#[tauri::command]
pub async fn fal_queue_status(
    api_key: String,
    endpoint_id: String,
    request_id: String,
    logs: bool,
) -> Result<FalQueueStatusResponse, String> {
    let client = fal_client()?;
    let queue_endpoint_id = normalize_queue_endpoint_id(&endpoint_id)?;
    let response = client
        .get(format!(
            "{FAL_QUEUE_BASE_URL}/{}/requests/{}/status",
            queue_endpoint_id,
            request_id
        ))
        .header("Authorization", normalize_authorization(&api_key))
        .query(&[("logs", if logs { "1" } else { "0" })])
        .send()
        .await
        .map_err(|error| format!("Fal queue status basarisiz oldu: {error}"))?;

    if !response.status().is_success() {
        return Err(response_error("Fal queue durum istegi", response).await);
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|error| format!("Fal queue status yaniti parse edilemedi: {error}"))?;

    let status = payload
        .get("status")
        .and_then(|value| value.as_str())
        .unwrap_or("UNKNOWN")
        .to_string();

    Ok(FalQueueStatusResponse {
        status,
        error: extract_error_message(&payload),
    })
}

#[tauri::command]
pub async fn fal_queue_result(
    api_key: String,
    endpoint_id: String,
    request_id: String,
) -> Result<FalQueueResultResponse, String> {
    let client = fal_client()?;
    let queue_endpoint_id = normalize_queue_endpoint_id(&endpoint_id)?;
    let response = client
        .get(format!(
            "{FAL_QUEUE_BASE_URL}/{}/requests/{}",
            queue_endpoint_id,
            request_id
        ))
        .header("Authorization", normalize_authorization(&api_key))
        .send()
        .await
        .map_err(|error| format!("Fal queue sonucu alinamadi: {error}"))?;

    if !response.status().is_success() {
        return Err(response_error("Fal queue sonuc istegi", response).await);
    }

    let request_id_header = response
        .headers()
        .get(REQUEST_ID_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    let data: Value = response
        .json()
        .await
        .map_err(|error| format!("Fal queue sonucu parse edilemedi: {error}"))?;

    Ok(FalQueueResultResponse {
        request_id: request_id_header,
        data,
    })
}

#[tauri::command]
pub async fn fal_queue_cancel(
    api_key: String,
    endpoint_id: String,
    request_id: String,
) -> Result<(), String> {
    let client = fal_client()?;
    let queue_endpoint_id = normalize_queue_endpoint_id(&endpoint_id)?;
    let response = client
        .put(format!(
            "{FAL_QUEUE_BASE_URL}/{}/requests/{}/cancel",
            queue_endpoint_id,
            request_id
        ))
        .header("Authorization", normalize_authorization(&api_key))
        .send()
        .await
        .map_err(|error| format!("Fal queue cancel basarisiz oldu: {error}"))?;

    if !response.status().is_success() {
        return Err(response_error("Fal queue iptal istegi", response).await);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{normalize_queue_endpoint_id, normalize_submit_endpoint_id};

    #[test]
    fn keeps_submit_path_for_nested_endpoint() {
        assert_eq!(
            normalize_submit_endpoint_id("fal-ai/nano-banana-2/edit").unwrap(),
            "fal-ai/nano-banana-2/edit"
        );
    }

    #[test]
    fn strips_submit_path_for_queue_tracking() {
        assert_eq!(
            normalize_queue_endpoint_id("fal-ai/nano-banana-2/edit").unwrap(),
            "fal-ai/nano-banana-2"
        );
    }

    #[test]
    fn preserves_namespace_for_queue_tracking() {
        assert_eq!(
            normalize_queue_endpoint_id("workflows/acme/demo/render").unwrap(),
            "workflows/acme/demo"
        );
    }
}
