import type { ModelCombo } from '../types'

export const prepareCombo = (combo: ModelCombo): ModelCombo | null => {
  const modelName = combo.model_name.trim()
  const modelId = combo.model_id.trim()
  const entries = combo.provider_models.map((entry) => ({
    channel_key: entry.channel_key.trim(),
    model_id: entry.model_id.trim(),
  }))

  if (!modelName || !modelId || entries.length === 0 || entries.some((entry) => !entry.channel_key || !entry.model_id)) {
    return null
  }

  return { model_name: modelName, model_id: modelId, enabled: combo.enabled, provider_models: entries }
}
