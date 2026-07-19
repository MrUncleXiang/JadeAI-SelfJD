'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Pencil,
  PlugZap,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  clearLegacyLlmConfigs,
  readLegacyLlmConfigs,
  type LegacyLlmConfig,
  type LlmFeature,
  type LlmProfileSummary,
  type LlmProvider,
  type LlmWireApi,
  useSettingsStore,
} from '@/stores/settings-store';

const PROVIDERS: Array<{ value: LlmProvider; label: string; baseUrl: string; model: string }> = [
  {
    value: 'openai-compatible',
    label: 'OpenAI / Compatible',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
  },
  {
    value: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-20250514',
  },
  {
    value: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.0-flash',
  },
];

const FEATURES: Array<{ value: LlmFeature; zh: string; en: string }> = [
  { value: 'resume', zh: '简历生成与编辑', en: 'Resume generation' },
  { value: 'jd', zh: 'JD 分析', en: 'JD analysis' },
  { value: 'vision', zh: '图片与文档理解', en: 'Vision and documents' },
  { value: 'interview', zh: '模拟面试', en: 'Mock interview' },
];

type ProfileForm = {
  name: string;
  provider: LlmProvider;
  wireApi: LlmWireApi;
  baseUrl: string;
  modelName: string;
  apiKey: string;
};

const NEW_FORM: ProfileForm = {
  name: '',
  provider: 'openai-compatible',
  wireApi: 'chat-completions',
  baseUrl: PROVIDERS[0].baseUrl,
  modelName: PROVIDERS[0].model,
  apiKey: '',
};

function providerLabel(provider: LlmProvider) {
  return PROVIDERS.find((item) => item.value === provider)?.label || provider;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json() as { message?: string; error?: string; code?: string };
    return body.message || body.error || body.code || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

function CapabilityBadge({
  enabled,
  label,
}: {
  enabled: boolean;
  label: string;
}) {
  return (
    <Badge variant={enabled ? 'default' : 'secondary'} className="gap-1 text-[10px]">
      {enabled ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {label}
    </Badge>
  );
}

export function LlmProfileSettings() {
  const locale = useLocale();
  const zh = locale === 'zh';
  const {
    llmProfiles,
    llmBindings,
    llmLoading,
    llmError,
    legacyLlmFallback,
    refreshLlm,
  } = useSettingsStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileForm>(NEW_FORM);
  const [showApiKey, setShowApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [legacyConfigs, setLegacyConfigs] = useState<LegacyLlmConfig[]>([]);
  const [migrating, setMigrating] = useState(false);

  useEffect(() => {
    setLegacyConfigs(readLegacyLlmConfigs(legacyLlmFallback));
  }, [legacyLlmFallback]);

  const editingProfile = useMemo(
    () => llmProfiles.find((profile) => profile.id === editingId) || null,
    [editingId, llmProfiles],
  );

  const resetForm = () => {
    setEditingId(null);
    setForm(NEW_FORM);
    setModels([]);
    setShowApiKey(false);
  };

  const editProfile = (profile: LlmProfileSummary) => {
    setEditingId(profile.id);
    setForm({
      name: profile.name,
      provider: profile.provider,
      wireApi: profile.wireApi || 'chat-completions',
      baseUrl: profile.baseUrl,
      modelName: profile.modelName,
      apiKey: '',
    });
    setModels([]);
  };

  const bindFeature = async (feature: LlmFeature, profileId: string | null) => {
    const response = await fetch(`/api/llm-bindings/${feature}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId }),
    });
    if (!response.ok) throw new Error(await errorMessage(response));
  };

  const saveProfile = async () => {
    if (!form.name.trim() || !form.baseUrl.trim() || !form.modelName.trim()) return;
    if (!editingId && !form.apiKey.trim()) return;
    setSaving(true);
    let createdProfileId: string | null = null;
    try {
      const payload = {
        name: form.name.trim(),
        provider: form.provider,
        ...(form.provider === 'openai-compatible' ? { wireApi: form.wireApi } : {}),
        baseUrl: form.baseUrl.trim(),
        modelName: form.modelName.trim(),
        ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
      };
      const response = await fetch(editingId ? `/api/llm-profiles/${editingId}` : '/api/llm-profiles', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const saved = await response.json() as LlmProfileSummary;
      if (!editingId) createdProfileId = saved.id;
      if (!editingId && llmProfiles.length === 0) {
        await Promise.all(FEATURES.map(({ value }) => bindFeature(value, saved.id)));
      }
      await refreshLlm();
      resetForm();
      toast.success(zh ? 'LLM 档案已保存' : 'LLM profile saved');
    } catch (error) {
      if (createdProfileId) {
        await fetch(`/api/llm-profiles/${createdProfileId}`, { method: 'DELETE' }).catch(() => undefined);
        await refreshLlm();
      }
      toast.error(error instanceof Error ? error.message : (zh ? '保存失败' : 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const deleteProfile = async (profile: LlmProfileSummary) => {
    if (!window.confirm(zh ? `确认删除“${profile.name}”？` : `Delete “${profile.name}”?`)) return;
    const response = await fetch(`/api/llm-profiles/${profile.id}`, { method: 'DELETE' });
    if (!response.ok) {
      toast.error(await errorMessage(response));
      return;
    }
    if (editingId === profile.id) resetForm();
    await refreshLlm();
    toast.success(zh ? '档案已删除' : 'Profile deleted');
  };

  const testProfile = async (profileId: string) => {
    setTestingId(profileId);
    try {
      const response = await fetch(`/api/llm-profiles/${profileId}/test`, { method: 'POST' });
      if (!response.ok) throw new Error(await errorMessage(response));
      const tested = await response.json() as LlmProfileSummary;
      await refreshLlm();
      toast.success(tested.capabilities.reachable
        ? (zh ? '连接成功，能力探测已更新' : 'Connected and capabilities updated')
        : (zh ? '连接失败，请检查配置' : 'Connection failed'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (zh ? '测试失败' : 'Test failed'));
    } finally {
      setTestingId(null);
    }
  };

  const fetchModels = async () => {
    if (!editingId) return;
    setModelLoading(true);
    try {
      const response = await fetch(`/api/ai/models?profileId=${encodeURIComponent(editingId)}`);
      if (!response.ok) throw new Error(await errorMessage(response));
      const data = await response.json() as { models: Array<{ id: string }> };
      setModels(data.models.map((item) => item.id));
      if (data.models.length === 0) toast.info(zh ? 'Provider 未返回模型列表' : 'Provider returned no models');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (zh ? '模型列表加载失败' : 'Failed to load models'));
    } finally {
      setModelLoading(false);
    }
  };

  const migrateLegacy = async () => {
    setMigrating(true);
    const created: LlmProfileSummary[] = [];
    try {
      for (const [index, legacy] of legacyConfigs.entries()) {
        const response = await fetch('/api/llm-profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `${providerLabel(legacy.provider)} ${index + 1}`,
            provider: legacy.provider,
            baseUrl: legacy.baseUrl,
            modelName: legacy.modelName,
            apiKey: legacy.apiKey,
          }),
        });
        if (!response.ok) throw new Error(await errorMessage(response));
        created.push(await response.json() as LlmProfileSummary);
      }
      if (created[0] && llmProfiles.length === 0) {
        const visionIndex = legacyConfigs.findIndex((legacy) => (
          legacy.provider === 'gemini' && /image/i.test(legacy.modelName)
        ));
        await Promise.all(FEATURES.map(({ value }) => bindFeature(
          value,
          value === 'vision' && created[visionIndex] ? created[visionIndex].id : created[0].id,
        )));
      }
      clearLegacyLlmConfigs();
      setLegacyConfigs([]);
      await refreshLlm();
      toast.success(zh ? '旧配置已迁移并从浏览器清除' : 'Legacy settings migrated and cleared');
    } catch (error) {
      await Promise.allSettled(created.map((profile) => (
        fetch(`/api/llm-profiles/${profile.id}`, { method: 'DELETE' })
      )));
      await refreshLlm();
      toast.error(error instanceof Error ? error.message : (zh ? '迁移失败，旧 Key 未清除' : 'Migration failed; legacy keys were kept'));
    } finally {
      setMigrating(false);
    }
  };

  return (
    <div className="max-h-[65vh] space-y-5 overflow-y-auto pr-1">
      {legacyConfigs.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          <div className="flex gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-2 text-xs">
              <p className="font-medium">
                {zh
                  ? `检测到 ${legacyConfigs.length} 个浏览器旧版 API Key。迁移后将改为服务端加密存储。`
                  : `${legacyConfigs.length} legacy browser API key(s) detected. Migrate them to encrypted server storage.`}
              </p>
              <div className="flex gap-2">
                <Button size="sm" className="h-7" onClick={migrateLegacy} disabled={migrating}>
                  {migrating && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  {zh ? '迁移并清除' : 'Migrate and clear'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  onClick={() => {
                    clearLegacyLlmConfigs();
                    setLegacyConfigs([]);
                  }}
                >
                  {zh ? '仅清除旧 Key' : 'Discard legacy keys'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">{zh ? 'LLM 档案' : 'LLM profiles'}</h3>
          <p className="text-xs text-zinc-500">
            {zh ? 'API Key 仅加密保存在服务端，不再通过业务请求 Header 传递。' : 'API keys are encrypted server-side and never sent in business request headers.'}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refreshLlm()} disabled={llmLoading}>
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${llmLoading ? 'animate-spin' : ''}`} />
          {zh ? '刷新' : 'Refresh'}
        </Button>
      </div>

      {llmError && <p className="text-xs text-red-500">{llmError}</p>}

      <div className="space-y-2">
        {llmProfiles.map((profile) => (
          <div key={profile.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium">{profile.name}</p>
                  <Badge variant={profile.status === 'active' ? 'default' : 'outline'}>{profile.status}</Badge>
                </div>
                <p className="mt-1 truncate text-xs text-zinc-500">
                  {providerLabel(profile.provider)} · {profile.modelName}
                </p>
                <p className="truncate text-[11px] text-zinc-400">
                  {profile.provider === 'openai-compatible'
                    ? (profile.wireApi === 'responses' ? 'Responses API' : 'Chat Completions API')
                    : providerLabel(profile.provider)}
                </p>
                <p className="truncate text-[11px] text-zinc-400">{profile.baseUrl}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="icon-xs" variant="ghost" onClick={() => editProfile(profile)} title={zh ? '编辑' : 'Edit'}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => void testProfile(profile.id)}
                  disabled={testingId === profile.id}
                  title={zh ? '连接与能力测试' : 'Connection and capability test'}
                >
                  {testingId === profile.id
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <PlugZap className="h-3.5 w-3.5" />}
                </Button>
                <Button size="icon-xs" variant="ghost" onClick={() => void deleteProfile(profile)} title={zh ? '删除' : 'Delete'}>
                  <Trash2 className="h-3.5 w-3.5 text-red-500" />
                </Button>
              </div>
            </div>
            {profile.lastTestedAt && (
              <div className="mt-2 flex flex-wrap gap-1">
                <CapabilityBadge enabled={profile.capabilities.reachable} label="Reachable" />
                <CapabilityBadge enabled={profile.capabilities.json} label="JSON" />
                <CapabilityBadge enabled={profile.capabilities.tools} label="Tools" />
                <CapabilityBadge enabled={profile.capabilities.vision} label="Vision" />
                {typeof profile.capabilities.latencyMs === 'number' && (
                  <Badge variant="outline" className="text-[10px]">{profile.capabilities.latencyMs} ms</Badge>
                )}
              </div>
            )}
          </div>
        ))}
        {llmProfiles.length === 0 && !llmLoading && (
          <div className="rounded-lg border border-dashed p-4 text-center text-xs text-zinc-500">
            {zh ? '尚未配置 LLM 档案。保存首个档案后会自动绑定到所有功能。' : 'No LLM profile yet. The first profile will be bound to all features.'}
          </div>
        )}
      </div>

      <Separator />

      <div className="space-y-3 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            {editingId ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {editingId ? (zh ? '编辑档案' : 'Edit profile') : (zh ? '新增档案' : 'Add profile')}
          </h3>
          {editingId && <Button variant="ghost" size="sm" onClick={resetForm}>{zh ? '取消' : 'Cancel'}</Button>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{zh ? '名称' : 'Name'}</Label>
            <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Primary OpenAI" />
          </div>
          <div className="space-y-1.5">
            <Label>Provider</Label>
            <Select
              value={form.provider}
              onValueChange={(value) => {
                const selected = PROVIDERS.find((item) => item.value === value)!;
                setForm({
                  ...form,
                  provider: selected.value,
                  wireApi: selected.value === 'openai-compatible' ? form.wireApi : 'chat-completions',
                  ...(!editingId ? { baseUrl: selected.baseUrl, modelName: selected.model } : {}),
                });
                setModels([]);
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>BaseURL</Label>
          <Input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} />
          <p className="text-[11px] text-zinc-400">
            {zh ? '默认仅允许公网 HTTPS；私网地址需由管理员加入 Allowlist。' : 'Public HTTPS only by default; private endpoints require an operator allowlist.'}
          </p>
        </div>
        {form.provider === 'openai-compatible' && (
          <div className="space-y-1.5">
            <Label>{zh ? '接口协议' : 'Wire API'}</Label>
            <Select
              value={form.wireApi}
              onValueChange={(wireApi) => setForm({ ...form, wireApi: wireApi as LlmWireApi })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="chat-completions">
                  {zh ? 'Chat Completions（传统兼容）' : 'Chat Completions (classic compatible)'}
                </SelectItem>
                <SelectItem value="responses">
                  {zh ? 'Responses（Codex/新式视觉）' : 'Responses (Codex / newer vision)'}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-zinc-400">
              {zh
                ? '如果同一 Provider 在 Codex 中可用、但 Chat Completions 超时，请选择 Responses。'
                : 'Choose Responses when the same provider works in Codex but Chat Completions times out.'}
            </p>
          </div>
        )}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>{zh ? '模型名称' : 'Model name'}</Label>
            {editingId && (
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => void fetchModels()} disabled={modelLoading}>
                {modelLoading && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                {zh ? '读取模型列表' : 'Load models'}
              </Button>
            )}
          </div>
          {models.length > 0 ? (
            <Select value={form.modelName} onValueChange={(modelName) => setForm({ ...form, modelName })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{models.map((model) => <SelectItem key={model} value={model}>{model}</SelectItem>)}</SelectContent>
            </Select>
          ) : (
            <Input value={form.modelName} onChange={(event) => setForm({ ...form, modelName: event.target.value })} />
          )}
        </div>
        <div className="space-y-1.5">
          <Label>API Key</Label>
          <div className="relative">
            <Input
              type={showApiKey ? 'text' : 'password'}
              value={form.apiKey}
              onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
              placeholder={editingProfile ? (zh ? '留空则保留现有 Key' : 'Leave blank to keep current key') : 'sk-...'}
              className="pr-10"
              autoComplete="off"
            />
            <Button type="button" variant="ghost" size="icon-xs" className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => setShowApiKey(!showApiKey)}>
              {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <p className="flex items-center gap-1 text-[11px] text-zinc-400"><KeyRound className="h-3 w-3" />AES-256-GCM</p>
        </div>
        <Button onClick={() => void saveProfile()} disabled={saving || !form.name.trim() || !form.baseUrl.trim() || !form.modelName.trim() || (!editingId && !form.apiKey.trim())}>
          {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          {zh ? '保存档案' : 'Save profile'}
        </Button>
      </div>

      <Separator />

      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">{zh ? '功能默认模型' : 'Feature bindings'}</h3>
          <p className="text-xs text-zinc-500">
            {zh ? '不同业务可使用不同 Provider、BaseURL 和模型。' : 'Each feature can use a different provider, BaseURL and model.'}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <div key={feature.value} className="space-y-1.5">
              <Label>{zh ? feature.zh : feature.en}</Label>
              <Select
                value={llmBindings[feature.value] || 'none'}
                onValueChange={async (value) => {
                  try {
                    await bindFeature(feature.value, value === 'none' ? null : value);
                    await refreshLlm();
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : (zh ? '绑定失败' : 'Binding failed'));
                  }
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{zh ? '未绑定' : 'Not bound'}</SelectItem>
                  {llmProfiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>{profile.name} · {profile.modelName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
