import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiClient } from '@/api/client'
import { AutoCompleteInput } from '@/components/ui/autocomplete'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { getChannelsForToken, getModelNamesForChannels, parseChannelConfig, parseTokenConfig } from '@/lib/channel-models'
import { buildPlaygroundBody, buildPlaygroundCurl } from '@/lib/playground-requests'
import { copyToClipboard } from '@/lib/utils'
import type { Channel, Token } from '@/types'

const tasks = {
  '/v1/images/generations': { label: 'imageGeneration', body: { prompt: '' }, files: [] },
  '/v1/images/edits': { label: 'imageEdit', body: { prompt: '' }, files: ['image', 'mask'] },
  '/v1/audio/speech': { label: 'speech', body: { input: '', voice: 'alloy' }, files: [] },
  '/v1/audio/transcriptions': { label: 'transcription', body: {}, files: ['file'] },
  '/v1/audio/translations': { label: 'translation', body: {}, files: ['file'] },
  '/v1/rerank': { label: 'rerank', body: { query: '', documents: [''] }, files: [] },
} as const

type Task = keyof typeof tasks
const apiBase = import.meta.env.VITE_API_BASE_URL || ''

export function MediaPlayground() {
  const { t } = useTranslation()
  const id = useId()
  const [task, setTask] = useState<Task>('/v1/images/generations')
  const [token, setToken] = useState('')
  const [model, setModel] = useState('')
  const [channel, setChannel] = useState('')
  const [body, setBody] = useState(JSON.stringify(tasks[task].body, null, 2))
  const [files, setFiles] = useState<Record<string, File>>({})
  const [tokens, setTokens] = useState<Token[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [result, setResult] = useState('')
  const [mediaUrl, setMediaUrl] = useState('')
  const [mediaType, setMediaType] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<number | null>(null)

  useEffect(() => {
    Promise.all([apiClient.getTokens(), apiClient.getChannels()]).then(([tokenResult, channelResult]) => {
      setTokens((tokenResult.data as Token[]) || [])
      setChannels((channelResult.data as Channel[]) || [])
    }).catch((error: unknown) => setResult(String(error)))
  }, [])
  useEffect(() => () => { if (mediaUrl) URL.revokeObjectURL(mediaUrl) }, [mediaUrl])

  const tokenChannels = useMemo(() => token ? getChannelsForToken(token, tokens, channels).filter((item) => parseChannelConfig(item).enabled !== false) : [], [token, tokens, channels])
  const models = useMemo(() => getModelNamesForChannels(channel ? tokenChannels.filter((item) => item.key === channel) : tokenChannels), [channel, tokenChannels])
  const selectedFiles = Object.entries(files).map(([field, file]) => ({ field, name: file.name }))
  const requiredFile = tasks[task].files[0]
  const curlFiles = requiredFile && !files[requiredFile]
    ? [{ field: requiredFile, name: requiredFile }, ...selectedFiles]
    : selectedFiles
  let curl = ''
  try {
    curl = buildPlaygroundCurl(apiBase || window.location.origin, task, token, channel, buildPlaygroundBody(body, model), curlFiles)
  } catch {
    // The request editor may contain incomplete JSON while typing.
  }

  const changeTask = (next: Task) => {
    setTask(next)
    setBody(JSON.stringify(tasks[next].body, null, 2))
    setFiles({})
    setResult('')
    setMediaUrl('')
    setStatus(null)
  }

  const send = async () => {
    setResult('')
    setMediaUrl('')
    setStatus(null)
    try {
      if (!token || !model) throw new Error(t('mediaPlayground.tokenModelRequired'))
      const payload = buildPlaygroundBody(body, model)
      const requiredFile = tasks[task].files[0]
      if (requiredFile && !files[requiredFile]) throw new Error(t('mediaPlayground.fileRequired', { field: requiredFile }))
      const headers: Record<string, string> = { Authorization: 'Bearer ' + token }
      if (channel) headers['x-channel-key'] = channel
      let requestBody: BodyInit
      if (tasks[task].files.length) {
        const form = new FormData()
        for (const [key, value] of Object.entries(payload)) form.append(key, typeof value === 'string' ? value : JSON.stringify(value))
        for (const [key, file] of Object.entries(files)) form.append(key, file)
        requestBody = form
      } else {
        headers['Content-Type'] = 'application/json'
        requestBody = JSON.stringify(payload)
      }
      setLoading(true)
      const response = await fetch(apiBase + task, { method: 'POST', credentials: 'omit', headers, body: requestBody })
      setStatus(response.status)
      const contentType = response.headers.get('content-type') || ''
      if (response.ok && (contentType.startsWith('audio/') || contentType.startsWith('image/'))) {
        setMediaType(contentType)
        setMediaUrl(URL.createObjectURL(await response.blob()))
      } else {
        const text = await response.text()
        try {
          const parsed = JSON.parse(text)
          setResult(JSON.stringify(parsed, null, 2))
          const firstImage = parsed?.data?.[0]
          if (response.ok && task.startsWith('/v1/images/') && firstImage) {
            if (typeof firstImage.b64_json === 'string') {
              setMediaType('image/png')
              setMediaUrl('data:image/png;base64,' + firstImage.b64_json)
            } else if (typeof firstImage.url === 'string' && /^https?:\/\//i.test(firstImage.url)) {
              setMediaType('image/png')
              setMediaUrl(firstImage.url)
            }
          }
        } catch { setResult(text) }
      }
    } catch (error) {
      setResult(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card><CardContent className="space-y-4 p-4">
        <div className="space-y-1"><Label htmlFor={id + '-task'}>{t('mediaPlayground.task')}</Label>
          <Select id={id + '-task'} value={task} onChange={(event) => changeTask(event.target.value as Task)}>
            {Object.entries(tasks).map(([path, config]) => <option key={path} value={path}>{t('mediaPlayground.' + config.label)} — {path}</option>)}
          </Select>
        </div>
        <div className="space-y-1"><Label htmlFor={id + '-token'}>{t('apiTest.apiToken')}</Label>
          <AutoCompleteInput id={id + '-token'} value={token} onChange={(value) => { setToken(value); setChannel(''); setModel('') }} options={tokens.map((item) => ({ value: item.key, label: parseTokenConfig(item).name || item.key, description: item.key }))} />
        </div>
        <div className="space-y-1"><Label htmlFor={id + '-channel'}>{t('apiTest.channel')}</Label>
          <AutoCompleteInput id={id + '-channel'} value={channel} onChange={setChannel} options={tokenChannels.map((item) => ({ value: item.key, label: parseChannelConfig(item).name || item.key }))} placeholder={t('apiTest.autoChannel')} />
        </div>
        <div className="space-y-1"><Label htmlFor={id + '-model'}>{t('apiTest.model')}</Label>
          <AutoCompleteInput id={id + '-model'} value={model} onChange={setModel} options={models.map((value) => ({ value }))} placeholder={t('apiTest.modelPlaceholder')} />
        </div>
        <div className="space-y-1"><Label htmlFor={id + '-body'}>{t('apiTest.requestBody')}</Label>
          <Textarea id={id + '-body'} value={body} onChange={(event) => setBody(event.target.value)} rows={8} className="font-mono text-xs" />
        </div>
        {tasks[task].files.map((field) => <div className="space-y-1" key={task + field}>
          <Label htmlFor={id + '-' + field}>{field}{field === 'mask' ? ' (' + t('mediaPlayground.optional') + ')' : ''}</Label>
          <Input id={id + '-' + field} type="file" accept={task === '/v1/images/edits' ? 'image/*' : 'audio/*'} onChange={(event) => setFiles((current) => {
            const next = { ...current }
            const file = event.target.files?.[0]
            if (file) next[field] = file
            else delete next[field]
            return next
          })} />
        </div>)}
        <Button type="button" disabled={loading} onClick={() => void send()}>{loading ? t('mediaPlayground.sending') : t('apiTest.send')}</Button>
      </CardContent></Card>
      <div className="space-y-4">
        <Card><CardContent className="space-y-2 p-4">
          <div className="flex items-center justify-between"><Label>cURL</Label><Button variant="outline" size="sm" disabled={!curl} onClick={() => void copyToClipboard(curl)}>{t('common.copy')}</Button></div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-xs">{curl || t('apiTest.bodyJsonError')}</pre>
        </CardContent></Card>
        <Card><CardContent className="space-y-2 p-4">
          <Label>{t('mediaPlayground.response')}{status !== null ? ' (' + status + ')' : ''}</Label>
          {mediaUrl && (mediaType.startsWith('audio/') ? <audio controls src={mediaUrl} className="w-full" /> : <img src={mediaUrl} alt={t('mediaPlayground.generatedImage')} className="max-w-full rounded-md" />)}
          {result && <pre className="max-h-[500px] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs">{result}</pre>}
        </CardContent></Card>
      </div>
    </div>
  )
}
