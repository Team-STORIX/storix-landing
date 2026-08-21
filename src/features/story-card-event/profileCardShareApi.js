import { apiRequest } from '../../lib/apiClient.js'

export async function postProfileCardImagePresignedUrl(contentType) {
  return apiRequest('/api/v1/image/profile-card', {
    method: 'POST',
    body: {
      file: { contentType },
    },
  })
}

export async function createProfileCardShare(objectKey) {
  return apiRequest('/api/v1/profile/card/share', {
    method: 'POST',
    body: { objectKey },
  })
}

export async function uploadProfileCardImage(params) {
  const image = await fetch(params.uri)
  const blob = await image.blob()

  const response = await fetch(params.url, {
    method: 'PUT',
    headers: {
      'Content-Type': params.contentType,
    },
    body: blob,
  })

  if (!response.ok) {
    throw new Error(`S3 upload failed: ${response.status}`)
  }
}
