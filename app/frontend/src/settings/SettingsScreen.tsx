// Seam 24 (settings) — THE SETTINGS SCREEN. Phase 04: fully ported, and it SAVES.
//
// PORTED FROM (by symbol, app.js): showSettings' loadSettings(), fillSettingsForm, loadSettings,
// saveSettings, adminToken, rememberAdminToken, the #settings-unlock-btn and #settings-save-btn
// listeners. Markup: index.html:365-440, class for class.
//
// ⚑ PHASE 04 (23-09-26). The Phase-03 screen was a bare stub: unstyled <p> elements, a disabled
//   Save, and no form at all — measured in the before-shots.
//
// ⛔⛔ :8792 IS UNAUTHENTICATED ON THE LAN. The server NEVER returns the API key or the access
//     token — only `api_key_set` / `access_token_set`. The two password fields always start
//     EMPTY and are only sent when the reader typed something (an omitted key KEEPS the stored
//     one; saving an unrelated preference must never blank a credential).
// ⛔ The admin token lives in sessionStorage only (dies with the tab), never localStorage.
// ⚠ D-P4-2: a Save rewrites the SHARED provider.env. :8792 re-reads it on the next request;
//   :8767 loads it only at start, so it sees the change after its next restart.
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSettingsWithToken } from '../data/client';
import { queryKeys } from '../data/queries';
import type { SettingsPayload } from '../data/queries';
import { adminToken, postJson, rememberAdminToken } from '../data/writes';
import { FIELD } from '../shell/ui';

// ⚑ 23-09-26: FIELD moved to shell/ui.ts (shared with Account + sign-in; adds a focus ring only).
const PRIMARY_BTN = 'bg-brand-600 hover:bg-brand-900 text-white font-bold uppercase tracking-wider text-sm transition-colors active:scale-95';

interface FormState {
  apiUrl: string;
  apiKey: string;
  model: string;
  jsonMode: boolean;
  accessToken: string;
  requireToken: boolean;
  aiCount: string;
  freshSize: string;
}

const EMPTY_FORM: FormState = {
  apiUrl: '',
  apiKey: '',
  model: '',
  jsonMode: true,
  accessToken: '',
  requireToken: false,
  aiCount: '',
  freshSize: '',
};

export function SettingsScreen({ open }: { open: boolean }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loaded, setLoaded] = useState<SettingsPayload | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [lockVisible, setLockVisible] = useState(false);
  const [lockStatus, setLockStatus] = useState('');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [adminField, setAdminField] = useState('');

  /** fillSettingsForm (app.js:3434). The two secret fields are ALWAYS emptied. */
  const fill = (data: SettingsPayload) => {
    setLoaded(data);
    setForm({
      apiUrl: data.api_url || '',
      apiKey: '',
      model: data.model || '',
      jsonMode: data.json_mode !== false,
      accessToken: '',
      requireToken: Boolean(data.general?.require_access_token),
      aiCount: String(data.general?.ai_question_count ?? ''),
      freshSize: String(data.general?.fresh_quiz_size ?? ''),
    });
    setShowForm(true);
    setLockVisible(Boolean(data.admin_required));
    setLockStatus(data.ready ? `Connected to ${data.model}. AI quiz generation is on.` : 'Not connected yet. Fill in the endpoint, key and model below, then Save.');
  };

  /** loadSettings (app.js:3456). */
  const load = async () => {
    try {
      const { ok, status: code, body } = await getSettingsWithToken<SettingsPayload & { error?: string }>(adminToken());
      if (!ok) throw new Error(body.error || `Request failed (${code}).`);
      fill(body);
    } catch (error) {
      setShowForm(false);
      setLockVisible(true);
      setLockStatus((error as Error).message);
    }
  };

  // showSettings() calls loadSettings() on EVERY visit, so the form never shows stale values.
  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** saveSettings (app.js:3469). */
  const save = async () => {
    const payload: Record<string, unknown> = {
      api_url: form.apiUrl.trim(),
      model: form.model.trim(),
      json_mode: form.jsonMode,
      require_access_token: form.requireToken,
      ai_question_count: Number(form.aiCount),
      fresh_quiz_size: Number(form.freshSize),
    };
    // Only send secrets the operator actually typed.
    if (form.apiKey.trim()) payload.api_key = form.apiKey.trim();
    if (form.accessToken.trim()) payload.access_token = form.accessToken.trim();
    setSaving(true);
    setStatus('Saving...');
    try {
      const response = await postJson('/api/settings', payload, { 'X-Edu-Admin-Token': adminToken() });
      const data = (await response.json()) as SettingsPayload & { error?: string };
      if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
      fill(data);
      setStatus(
        data.ready
          ? 'Saved. Quiz generation is live now, no restart needed.'
          : 'Saved, but the provider is still incomplete (endpoint, key and model are all required).',
      );
      // refreshProviderStatus() + loadGeneralSettings() (app.js:3497).
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.provider }),
        queryClient.invalidateQueries({ queryKey: queryKeys.general }),
        queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
      ]);
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <>
      <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 sm:p-8">
        <h2 className="text-3xl text-white font-light mb-2">Settings</h2>
        <p className="text-brand-600 uppercase tracking-widest text-sm font-semibold">Connect an AI model to generate quizzes</p>
        <p id="settings-lock-status" className="mt-4 text-sm text-gray-400" role="status">
          {lockStatus}
        </p>
      </div>

      {/* Only shown when someone has deliberately set EDU_ADMIN_TOKEN on the server. */}
      <div id="settings-lock-card" className={`${lockVisible ? '' : 'hidden-view '}bg-gray-800 border border-gray-700 rounded-2xl p-6 sm:p-8`}>
        <label htmlFor="admin-token" className="block text-sm font-semibold text-gray-200 mb-2">Admin token</label>
        <input
          id="admin-token"
          type="password"
          autoComplete="off"
          className={FIELD}
          placeholder="This server has settings locked"
          value={adminField}
          onChange={(event) => setAdminField(event.target.value)}
        />
        <button
          id="settings-unlock-btn"
          type="button"
          className={`mt-4 min-h-[44px] px-6 rounded-lg ${PRIMARY_BTN}`}
          onClick={() => {
            const token = adminField.trim();
            if (!token) {
              setLockStatus('Enter the admin token first.');
              return;
            }
            rememberAdminToken(token);
            setAdminField('');
            void load();
          }}
        >
          Unlock
        </button>
      </div>

      <div id="settings-form" className={`${showForm ? '' : 'hidden-view '}space-y-6`}>
        <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 sm:p-8">
          <h3 className="text-xl text-white font-semibold mb-1">AI model connection</h3>
          <p className="text-sm text-gray-400 mb-6">
            Any OpenAI-compatible Chat Completions endpoint. Credentials are stored on the server; the browser never receives the key back.
          </p>
          <div className="space-y-5">
            <div>
              <label htmlFor="set-api-url" className="block text-sm font-semibold text-gray-200 mb-2">Endpoint URL</label>
              <input
                id="set-api-url"
                type="url"
                spellCheck={false}
                className={FIELD}
                placeholder="https://api.openai.com/v1/chat/completions"
                value={form.apiUrl}
                onChange={(event) => set('apiUrl', event.target.value)}
              />
              <p className="mt-2 text-xs leading-5 text-gray-500">Must be https://, or http:// on localhost for a model running on this box.</p>
            </div>
            <div>
              <label htmlFor="set-api-key" className="block text-sm font-semibold text-gray-200 mb-2">API key</label>
              <input
                id="set-api-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                className={FIELD}
                value={form.apiKey}
                onChange={(event) => set('apiKey', event.target.value)}
              />
              <p id="api-key-state" className="mt-2 text-xs leading-5 text-gray-500">
                {loaded
                  ? loaded.api_key_set
                    ? 'A key is stored on the server. Leave blank to keep it; type a new one to replace it.'
                    : 'No key stored yet. Quiz generation stays off until one is saved.'
                  : ''}
              </p>
            </div>
            <div>
              <label htmlFor="set-model" className="block text-sm font-semibold text-gray-200 mb-2">Model</label>
              {/* ⚑ The contract's `[type="text"]` entry is REALLY this element (index.html:399). */}
              <input
                id="set-model"
                type="text"
                spellCheck={false}
                className={FIELD}
                placeholder="gpt-4o-mini"
                value={form.model}
                onChange={(event) => set('model', event.target.value)}
              />
            </div>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                id="set-json-mode"
                type="checkbox"
                className="mt-1 h-5 w-5 rounded border-gray-600 bg-gray-900 text-brand-600 focus:ring-brand-600"
                checked={form.jsonMode}
                onChange={(event) => set('jsonMode', event.target.checked)}
              />
              <span className="text-sm text-gray-300">
                Ask the model for strict JSON
                <span className="block text-xs text-gray-500 mt-1">Turn off only if your provider rejects response_format.</span>
              </span>
            </label>
          </div>
        </div>

        <details className="bg-gray-800 border border-gray-700 rounded-2xl p-6 sm:p-8">
          <summary className="cursor-pointer text-xl text-white font-semibold">
            Restrict who can generate{' '}
            <span className="block text-sm font-normal text-gray-400 mt-1">Optional. Leave closed unless you share this page with other people.</span>
          </summary>
          <div className="mt-6">
            <label htmlFor="set-access-token" className="block text-sm font-semibold text-gray-200 mb-2">Learner access token</label>
            <input
              id="set-access-token"
              type="password"
              autoComplete="off"
              className={FIELD}
              placeholder="Leave blank for no gate"
              value={form.accessToken}
              onChange={(event) => set('accessToken', event.target.value)}
            />
            <p id="access-token-state" className="mt-2 text-xs leading-5 text-gray-500">
              {loaded ? (loaded.access_token_set ? 'A token is stored. Leave blank to keep it.' : 'No token stored.') : ''}
            </p>
            <label className="flex items-start gap-3 cursor-pointer mt-5">
              <input
                id="set-require-token"
                type="checkbox"
                className="mt-1 h-5 w-5 rounded border-gray-600 bg-gray-900 text-brand-600 focus:ring-brand-600"
                checked={form.requireToken}
                onChange={(event) => set('requireToken', event.target.checked)}
              />
              <span className="text-sm text-gray-300">
                Ask for this token before generating
                <span className="block text-xs text-gray-500 mt-1">Off means anyone who can open this page can spend your provider credit.</span>
              </span>
            </label>
          </div>
        </details>

        <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 sm:p-8">
          <h3 className="text-xl text-white font-semibold mb-6">Study preferences</h3>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label htmlFor="set-ai-count" className="block text-sm font-semibold text-gray-200 mb-2">Questions per AI quiz</label>
              <input
                id="set-ai-count"
                type="number"
                min={3}
                max={10}
                className={FIELD}
                value={form.aiCount}
                onChange={(event) => set('aiCount', event.target.value)}
              />
              <p className="mt-2 text-xs leading-5 text-gray-500">Between 3 and 10.</p>
            </div>
            <div>
              <label htmlFor="set-fresh-size" className="block text-sm font-semibold text-gray-200 mb-2">Questions per fresh AI quiz</label>
              <input
                id="set-fresh-size"
                type="number"
                min={5}
                max={30}
                className={FIELD}
                value={form.freshSize}
                onChange={(event) => set('freshSize', event.target.value)}
              />
              <p className="mt-2 text-xs leading-5 text-gray-500">Between 5 and 30. About 5 per book section.</p>
            </div>
          </div>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center gap-4">
          <button
            id="settings-save-btn"
            type="button"
            disabled={saving}
            className={`min-h-[44px] px-8 rounded-lg ${PRIMARY_BTN} shrink-0`}
            onClick={() => void save()}
          >
            Save settings
          </button>
          <p id="settings-status" className="text-sm text-gray-400" role="status">
            {status}
          </p>
        </div>
      </div>
    </>
  );
}
