export function buildPlaygroundBody(json: string, model: string): Record<string, unknown> {
  const value: unknown = JSON.parse(json || '{}')
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Request body must be a JSON object')
  return { ...value, model }
}

const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'"

export function buildPlaygroundCurl(
  baseUrl: string,
  endpoint: string,
  token: string,
  channel: string,
  body: Record<string, unknown>,
  files: Array<{ field: string; name: string }> = [],
): string {
  const lines = [
    'curl ' + shellQuote(baseUrl + endpoint),
    '-H ' + shellQuote('Authorization: Bearer ' + token),
  ]
  if (channel) lines.push('-H ' + shellQuote('x-channel-key: ' + channel))
  if (files.length) {
    for (const [key, value] of Object.entries(body)) {
      lines.push('--form-string ' + shellQuote(key + '=' + (typeof value === 'string' ? value : JSON.stringify(value))))
    }
    for (const file of files) lines.push('-F ' + shellQuote(file.field + '=@' + file.name))
  } else {
    lines.push('-H ' + shellQuote('Content-Type: application/json'))
    lines.push('--data-raw ' + shellQuote(JSON.stringify(body)))
  }
  return lines.join(' \\\n  ')
}
