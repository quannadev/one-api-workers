import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { apiClient } from '@/api/client'
import type { Channel, ModelCombo, ModelComboEntry } from '@/types'
import { getChannelModels, parseChannelConfig } from '@/lib/channel-models'
import { prepareCombo } from '@/lib/model-combos'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageContainer } from '@/components/ui/page-container'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/use-toast'

const emptyEntry = (): ModelComboEntry => ({ channel_key: '', model_id: '' })
const emptyCombo = (): ModelCombo => ({ model_name: '', model_id: '', enabled: true, provider_models: [emptyEntry()] })

export function ModelCombos() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { addToast } = useToast()
  const [draft, setDraft] = useState<ModelCombo | null>(null)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState<ModelCombo | null>(null)
  const [validationError, setValidationError] = useState(false)

  const combos = useQuery({
    queryKey: ['model-combos'],
    queryFn: async () => (await apiClient.getModelCombos()).data ?? [],
  })
  const channels = useQuery({
    queryKey: ['channels'],
    queryFn: async () => (await apiClient.getChannels()).data as Channel[],
  })
  const save = useMutation({
    mutationFn: apiClient.saveModelCombo,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['model-combos'] })
      setDraft(null)
      addToast(t('modelCombos.saved'), 'success')
    },
    onError: (error: Error) => addToast(t('common.saveFailed', { message: error.message }), 'error'),
  })
  const remove = useMutation({
    mutationFn: apiClient.deleteModelCombo,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['model-combos'] })
      setDeleting(null)
      addToast(t('modelCombos.deleted'), 'success')
    },
    onError: (error: Error) => addToast(t('common.deleteFailed', { message: error.message }), 'error'),
  })
  const edit = (combo?: ModelCombo) => {
    setEditing(Boolean(combo))
    setValidationError(false)
    setDraft(combo ? { ...combo, provider_models: combo.provider_models.map((entry) => ({ ...entry })) } : emptyCombo())
  }
  const updateEntry = (index: number, changes: Partial<ModelComboEntry>) => {
    setDraft((current) => current && ({
      ...current,
      provider_models: current.provider_models.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...changes } : entry),
    }))
  }
  const moveEntry = (index: number, direction: number) => {
    setDraft((current) => {
      if (!current) return current
      const entries = [...current.provider_models]
      const target = index + direction
      if (target < 0 || target >= entries.length) return current
      const item = entries[index]
      entries[index] = entries[target]
      entries[target] = item
      return { ...current, provider_models: entries }
    })
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!draft) return
    const combo = prepareCombo(draft)
    if (!combo) {
      setValidationError(true)
      return
    }
    setValidationError(false)
    save.mutate(combo)
  }

  return (
    <PageContainer title={t('modelCombos.title')} description={t('modelCombos.description')}
      actions={<Button disabled={save.isPending} onClick={() => edit()}><Plus />{t('modelCombos.create')}</Button>}>
      {combos.isLoading ? <p className="text-sm text-muted-foreground">{t('common.loading')}</p> :
        combos.isError ? <p role="alert" className="text-sm text-destructive">{t('modelCombos.loadError')}</p> :
          combos.data?.length === 0 ? (
            <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{t('modelCombos.empty')}</div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {combos.data?.map((combo) => (
                <Card key={combo.model_name}>
                  <CardContent className="space-y-4 p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h2 className="break-words text-base font-semibold">{combo.model_name}</h2>
                        <p className="mt-1 break-all font-mono text-sm text-muted-foreground">{combo.model_id}</p>
                      </div>
                      <span className={combo.enabled ? 'shrink-0 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600' : 'shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground'}>
                        {combo.enabled ? t('common.enabled') : t('common.disabled')}
                      </span>
                    </div>
                    <div className="space-y-2 rounded-lg bg-muted/40 p-3">
                      {combo.provider_models.map((entry, index) => (
                        <div key={entry.channel_key + '-' + entry.model_id + '-' + index} className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm">
                          <span className="font-medium">{entry.channel_key}</span><span className="text-muted-foreground">/</span>
                          <span className="break-all font-mono text-muted-foreground">{entry.model_id}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t pt-4">
                      <div className="flex items-center gap-2 text-sm">
                        <Switch aria-label={t('modelCombos.toggle', { name: combo.model_name })} checked={combo.enabled} disabled={save.isPending} onCheckedChange={(enabled) => save.mutate({ ...combo, enabled })} />
                        <span className="text-muted-foreground">{combo.enabled ? t('common.enabled') : t('common.disabled')}</span>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" disabled={save.isPending} onClick={() => edit(combo)}><Pencil />{t('common.edit')}</Button>
                        <Button variant="ghost" size="sm" disabled={save.isPending} onClick={() => setDeleting(combo)}><Trash2 />{t('common.delete')}</Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
      <Dialog open={Boolean(draft)} onOpenChange={(open) => { if (!open && !save.isPending) setDraft(null) }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t('modelCombos.edit') : t('modelCombos.create')}</DialogTitle>
            <DialogDescription>{t('modelCombos.formDescription')}</DialogDescription>
          </DialogHeader>
          {draft && <form onSubmit={submit} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="combo-name">{t('modelCombos.name')}</Label>
                <Input id="combo-name" value={draft.model_name} disabled={editing} onChange={(event) => setDraft({ ...draft, model_name: event.target.value })} />
              </div>
              <div className="space-y-2"><Label htmlFor="combo-id">{t('modelCombos.modelId')}</Label>
                <Input id="combo-id" value={draft.model_id} onChange={(event) => setDraft({ ...draft, model_id: event.target.value })} />
              </div>
            </div>
            <div className="flex items-center gap-3"><Switch id="combo-enabled" checked={draft.enabled} onCheckedChange={(enabled) => setDraft({ ...draft, enabled })} /><Label htmlFor="combo-enabled">{t('common.enabled')}</Label></div>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div><h3 className="text-sm font-semibold">{t('modelCombos.providers')}</h3><p className="mt-1 text-xs text-muted-foreground">{t('modelCombos.orderHelp')}</p></div>
                <Button type="button" variant="outline" size="sm" onClick={() => setDraft({ ...draft, provider_models: [...draft.provider_models, emptyEntry()] })}><Plus />{t('common.add')}</Button>
              </div>
              {channels.isError && <p role="alert" className="text-sm text-destructive">{t('modelCombos.channelsError')}</p>}
              {draft.provider_models.map((entry, index) => {
                const selectedChannel = channels.data?.find((channel) => channel.key === entry.channel_key)
                const options = selectedChannel ? getChannelModels(parseChannelConfig(selectedChannel)) : []
                return (
                  <div key={index} className="rounded-lg border p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5"><Label htmlFor={'combo-channel-' + index}>{t('modelCombos.channel')}</Label>
                        <Select id={'combo-channel-' + index} value={entry.channel_key} placeholder={t('modelCombos.selectChannel')} onChange={(event) => updateEntry(index, { channel_key: event.target.value, model_id: '' })}>
                          {entry.channel_key && !selectedChannel && <option value={entry.channel_key}>{entry.channel_key}</option>}
                          {channels.data?.map((channel) => <option key={channel.key} value={channel.key}>{parseChannelConfig(channel).name || channel.key} ({channel.key})</option>)}
                        </Select>
                      </div>
                      <div className="space-y-1.5"><Label htmlFor={'combo-provider-model-' + index}>{t('modelCombos.providerModel')}</Label>
                        <Input id={'combo-provider-model-' + index} list={'combo-models-' + index} value={entry.model_id} onChange={(event) => updateEntry(index, { model_id: event.target.value })} />
                        <datalist id={'combo-models-' + index}>{options.filter((model) => model.enabled !== false).map((model) => <option key={model.name + '-' + model.id} value={model.id}>{model.name}</option>)}</datalist>
                      </div>
                    </div>
                    <div className="mt-2 flex justify-end gap-1">
                      <Button type="button" variant="ghost" size="icon" aria-label={t('modelCombos.moveUp')} disabled={index === 0} onClick={() => moveEntry(index, -1)}><ArrowUp /></Button>
                      <Button type="button" variant="ghost" size="icon" aria-label={t('modelCombos.moveDown')} disabled={index === draft.provider_models.length - 1} onClick={() => moveEntry(index, 1)}><ArrowDown /></Button>
                      <Button type="button" variant="ghost" size="icon" aria-label={t('modelCombos.removeEntry')} disabled={draft.provider_models.length === 1} onClick={() => setDraft({ ...draft, provider_models: draft.provider_models.filter((_, entryIndex) => entryIndex !== index) })}><Trash2 /></Button>
                    </div>
                  </div>
                )
              })}
            </div>
            {validationError && <p role="alert" className="text-sm text-destructive">{t('modelCombos.required')}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDraft(null)} disabled={save.isPending}>{t('common.cancel')}</Button>
              <Button type="submit" disabled={save.isPending}>{save.isPending ? t('common.saving') : t('common.save')}</Button>
            </DialogFooter>
          </form>}
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open && !remove.isPending) setDeleting(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('modelCombos.deleteTitle')}</DialogTitle><DialogDescription>{t('modelCombos.deleteDescription', { name: deleting?.model_name })}</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={remove.isPending} onClick={() => setDeleting(null)}>{t('common.cancel')}</Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => { if (deleting) remove.mutate(deleting.model_name) }}>{t('common.delete')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
