// Vues de la barre latérale Crew : liste des agents, agent sélectionné, demandes, paramètres.

import type { Accessory, AgentPatch, ClientMessage, HostMessage, SceneAgent, SceneState, SettingsAgent, SettingsData } from '../types';
import { collapsible, type DetailOptions, renderAgentDetail } from './detail';
import { type Child, el, fill, section } from './dom';
import { BUBBLE_TTL_MS, STATUS_COLORS, STATUS_LABELS } from './status';
import { requestTime, sumRequests, usageLines, usageSummary, formatUsd } from './usageView';

declare function acquireVsCodeApi(): { postMessage(message: ClientMessage): void };

const vscode = acquireVsCodeApi();
const view = document.body.dataset.view as 'agents' | 'agent' | 'requests' | 'settings';
const root = document.getElementById('root')!;

const ACCESSORY_LABELS: Record<Accessory, string> = {
  none: 'Aucun',
  plant: 'Plante',
  lamp: 'Lampe',
  mug: 'Mug',
  books: 'Livres',
  server: 'Baie serveur',
  magnifier: 'Loupe',
  trophy: 'Trophée',
  shield: 'Bouclier',
};

let state: SceneState | undefined;
let selectedId: string | undefined;
let settings: SettingsData | undefined;
let settingsPending = false;
const openEditors = new Set<string>();
/**
 * Blocs repliables : les sections de la fiche (« role », « activity »…) sont mémorisées par l'extension,
 * les détails d'une demande (« request:<id> ») le temps de la vue.
 */
let folds: Record<string, boolean> = {};

const post = (message: ClientMessage) => vscode.postMessage(message);

const foldOptions: Pick<DetailOptions, 'isOpen' | 'onToggle'> = {
  isOpen: (key, byDefault) => folds[key] ?? byDefault,
  onToggle: (key, open) => {
    folds[key] = open;
    if (!key.includes(':')) post({ type: 'ui', folds: Object.fromEntries(Object.entries(folds).filter(([k]) => !k.includes(':'))) });
  },
};

window.addEventListener('message', (event) => {
  const message = event.data as HostMessage;
  if (message.type === 'state') state = message.state;
  else if (message.type === 'selection') selectedId = message.agentId;
  else if (message.type === 'settings') settings = message.data;
  else if (message.type === 'ui') folds = { ...folds, ...message.folds };
  else return;
  render();
});
post({ type: 'ready' });
render();

function render(): void {
  if (view === 'agents') {
    // La liste est reconstruite à chaque mise à jour : on rend le focus clavier à la même ligne.
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.agentId;
    fill(root, renderAgents());
    if (focused) root.querySelector<HTMLElement>(`[data-agent-id="${CSS.escape(focused)}"]`)?.focus();
  }
  else if (view === 'agent' || view === 'requests') {
    // Ne pas réinitialiser le défilement à chaque mise à jour.
    const scroll = document.scrollingElement?.scrollTop ?? 0;
    fill(root, view === 'agent' ? renderSelected() : renderRequests());
    if (document.scrollingElement) document.scrollingElement.scrollTop = scroll;
  }
  else renderSettingsWhenIdle();
}

// ---- Liste des agents -------------------------------------------------------------------------

function renderAgents(): Child[] {
  if (!state) return [el('p', { className: 'muted empty' }, 'Ouvrez un dossier de projet pour voir ses agents.')];
  return [
    el('div', { className: 'header' },
      el('span', { className: `dot ${state.watching ? 'live' : ''}`, title: state.watching ? 'Session suivie en direct' : 'Aucune session' }),
      el('strong', {}, state.project),
      state.sessionTitle && el('span', { className: 'muted ellipsis' }, `· ${state.sessionTitle}`),
    ),
    state.notice && el('p', { className: 'notice' }, state.notice),
    el('ul', { className: 'agent-list' }, ...state.agents.map(agentRow)),
  ];
}

function agentRow(agent: SceneAgent): HTMLElement {
  const { status, bubble } = agent.runtime;
  const activity = status !== 'idle' && bubble && Date.now() - bubble.at < BUBBLE_TTL_MS * 3 ? bubble.text : '';
  const selected = agent.id === selectedId;
  const row = el('button', {
    className: `row ${selected ? 'selected' : ''}`,
    title: agent.description,
    onclick: () => post({ type: 'select', agentId: selected ? undefined : agent.id }),
  },
      el('span', { className: 'swatch-dot', style: `background:${agent.color}` }),
      el('span', { className: 'row-main' },
        el('span', { className: 'row-title' },
          el('span', { className: 'name' }, agent.name),
          agent.isMain && el('span', { className: 'tag' }, 'principal'),
          agent.temp && el('span', { className: 'tag' }, 'intérim'),
        ),
        activity && el('span', { className: 'activity' }, activity),
      ),
      el('span', { className: 'row-status' },
        el('span', { className: 'status-dot', style: `background:${STATUS_COLORS[status]}` }),
        STATUS_LABELS[status],
      ),
  );
  row.dataset.agentId = agent.id;
  row.setAttribute('aria-pressed', String(selected));
  return el('li', {}, row);
}

// ---- Agent sélectionné --------------------------------------------------------------------------

function renderSelected(): Child[] {
  const agent = selectedId ? state?.agents.find((a) => a.id === selectedId) : undefined;
  if (!agent) return [el('p', { className: 'muted empty' }, 'Cliquez sur un agent dans l’open-space ou dans la liste.')];
  return renderAgentDetail(agent, {
    ...foldOptions,
    requests: state?.requests,
    onOpenSource: agent.source ? () => post({ type: 'openSource', agentId: agent.id }) : undefined,
  });
}

// ---- Demandes : consommation de tokens ------------------------------------------------------------

function renderRequests(): Child[] {
  if (!state) return [el('p', { className: 'muted empty' }, 'Aucune session suivie.')];
  const requests = [...state.requests].reverse();
  const nameOf = (id: string) => state!.agents.find((a) => a.id === id)?.name ?? id;
  const colorOf = (id: string) => state!.agents.find((a) => a.id === id)?.color ?? '#8a8f98';
  const cost = state.sessionCost;

  return [
    collapsible('requests:session', 'Session', true, foldOptions, 'section',
      el('p', { className: 'muted summary-line' }, `${state.requests.length} demande${state.requests.length > 1 ? 's' : ''}`),
      usageLines(sumRequests(state.requests)),
      cost &&
        el('div', { className: 'real-cost' },
          el('h4', {}, 'Coût réel enregistré par Claude Code'),
          el('dl', { className: 'usage' },
            el('dt', { className: 'total' }, 'Total'), el('dd', { className: 'total' }, formatUsd(cost.totalUsd)),
            ...cost.byModel.flatMap((m) => [el('dt', {}, m.model), el('dd', {}, formatUsd(m.costUsd))]),
          ),
        ),
    ),
    ...requests.map((request, index) =>
      collapsible(`request:${request.id}`, `${requestTime(request)} · ${request.prompt}`, index === 0, foldOptions, 'request',
        el('p', { className: 'muted summary-line' }, usageSummary(request.total)),
        el('h4', {}, 'Bilan'),
        usageLines(request.total),
        ...Object.entries(request.byAgent)
          .filter(([, usage]) => usage.calls > 0)
          .map(([agentId, usage]) => {
            const details = collapsible(`request:${request.id}:${agentId}`, nameOf(agentId), false, foldOptions, 'agent-usage',
              el('p', { className: 'muted summary-line' }, usageSummary(usage)),
              usageLines(usage),
            );
            details.querySelector('summary')!.prepend(el('span', { className: 'swatch-dot', style: `background:${colorOf(agentId)}` }));
            return details;
          }),
      ),
    ),
    requests.length === 0 && el('p', { className: 'muted empty' }, 'Aucune demande dans cette session.'),
  ];
}

// ---- Paramètres -------------------------------------------------------------------------------------

/** Ne reconstruit pas le formulaire pendant une saisie : on attend que le champ perde le focus. */
function renderSettingsWhenIdle(): void {
  if (root.contains(document.activeElement) && document.activeElement !== document.body && /^(INPUT|SELECT)$/.test(document.activeElement!.tagName)) {
    settingsPending = true;
    return;
  }
  settingsPending = false;
  fill(root, renderSettings());
}

root.addEventListener('focusout', () => {
  // Laisse le temps à l'événement « change » d'être traité avant de reconstruire.
  if (view === 'settings' && settingsPending) setTimeout(renderSettingsWhenIdle, 0);
});

function renderSettings(): Child[] {
  const d = settings;
  if (!d) return [el('p', { className: 'muted empty' }, 'Chargement des paramètres…')];
  const updateAgent = (id: string, patch: AgentPatch) => post({ type: 'updateAgent', id, patch });

  return [
    d.configError && el('p', { className: 'notice error' }, d.configError),
    el('p', { className: 'muted hint' },
      d.configExists ? 'Réglages du projet enregistrés dans ' : 'Les réglages du projet seront enregistrés dans ',
      el('code', {}, '.crew-view/config.json'),
      ' (à commiter).',
    ),
    section('Projet',
      field('Agent principal (orchestrateur)',
        selectInput(
          [['', 'Détection automatique'], ...d.definitions.map((def): [string, string] => [def.id, def.name])],
          d.orchestrator ?? '',
          (value) => post({ type: 'updateProject', patch: { orchestrator: value } }),
        ),
      ),
      field('Dossiers d’agents supplémentaires',
        textInput(d.agentsDirs.join(', '), 'ex. config/ia/agents', (value) => post({ type: 'updateProject', patch: { agentsDirs: value.split(',') } })),
      ),
    ),
    section('Agents', ...d.agents.map((agent) => agentEditor(agent, d, updateAgent))),
    section('Général',
      field('Port du navigateur',
        textInput(String(d.port), '4719', (value) => {
          const port = Number(value);
          if (Number.isInteger(port) && port > 0 && port < 65536) post({ type: 'updateSetting', key: 'port', value: port });
        }, 'number'),
      ),
      field('Dossier de configuration Claude',
        textInput(d.claudeConfigDir, '~/.claude (par défaut)', (value) => post({ type: 'updateSetting', key: 'claudeConfigDir', value: value.trim() })),
      ),
    ),
    section('Actions',
      el('div', { className: 'actions' },
        button('Ouvrir l’open-space', () => post({ type: 'command', command: 'crewView.open' }), true),
        button('Ouvrir dans le navigateur', () => post({ type: 'command', command: 'crewView.openInBrowser' })),
        button('Générer les agents Claude Code', () => post({ type: 'command', command: 'crewView.generateClaudeAgents' })),
        button(d.configExists ? 'Ouvrir config.json' : 'Créer config.json', () => post({ type: 'command', command: 'crewView.initConfig' })),
      ),
    ),
  ];
}

function agentEditor(agent: SettingsAgent, d: SettingsData, update: (id: string, patch: AgentPatch) => void): HTMLElement {
  const details = el('details', { className: 'agent-editor', open: openEditors.has(agent.id) },
    el('summary', {},
      el('span', { className: 'swatch-dot', style: `background:${agent.color}` }),
      el('span', { className: `name ${agent.hidden ? 'muted' : ''}` }, agent.name),
      agent.isMain && el('span', { className: 'tag' }, 'principal'),
      agent.temp && el('span', { className: 'tag' }, 'intérim'),
      agent.hidden && el('span', { className: 'tag' }, 'masqué'),
    ),
    el('div', { className: 'editor-body' },
      field('Nom affiché', textInput(agent.label ?? '', agent.defaultName, (value) => update(agent.id, { label: value }))),
      field('Couleur', colorInput(agent.color, (value) => update(agent.id, { color: value }))),
      !agent.temp && field('Accessoire',
        selectInput(d.accessories.map((a): [string, string] => [a, ACCESSORY_LABELS[a]]), agent.accessory, (value) => update(agent.id, { accessory: value as Accessory })),
      ),
      !agent.isMain && !agent.temp && field('Poste', slotInput(agent, d, (slot) => update(agent.id, { slot }))),
      !agent.isMain && checkbox('Masquer dans l’open-space', agent.hidden, (checked) => update(agent.id, { hidden: checked })),
    ),
  );
  details.addEventListener('toggle', () => {
    if (details.open) openEditors.add(agent.id);
    else openEditors.delete(agent.id);
  });
  return details;
}

function slotInput(agent: SettingsAgent, d: SettingsData, onChange: (slot: number) => void): HTMLSelectElement {
  const occupantOf = (index: number) => d.agents.find((a) => a.id !== agent.id && !a.hidden && !a.temp && !a.isMain && a.slot === index);
  const options: [string, string][] = d.slots.map((slot, index) => {
    const occupant = occupantOf(index);
    return [String(index), occupant ? `${slot.label} (échange avec ${occupant.name})` : slot.label];
  });
  if (agent.slot < 0) options.unshift(['-1', agent.desk ? `Personnalisé (${agent.desk[0]}, ${agent.desk[1]})` : 'Personnalisé']);
  const select = selectInput(options, String(agent.slot), (value) => {
    const slot = Number(value);
    if (slot >= 0) onChange(slot);
  });
  if (agent.slot < 0) (select.options[0] as HTMLOptionElement).disabled = true;
  return select;
}

// ---- Champs ----------------------------------------------------------------------------------------

let fieldCounter = 0;

function field(label: string, control: HTMLElement): HTMLElement {
  const id = `field-${++fieldCounter}`;
  control.id = id;
  return el('div', { className: 'field' }, el('label', { htmlFor: id }, label), control);
}

function textInput(value: string, placeholder: string, onChange: (value: string) => void, type = 'text'): HTMLInputElement {
  const input = el('input', { type, value, placeholder });
  input.addEventListener('change', () => onChange(input.value));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
  });
  return input;
}

function colorInput(value: string, onChange: (value: string) => void): HTMLInputElement {
  const input = el('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(value) ? value : '#888888' });
  input.addEventListener('change', () => onChange(input.value));
  return input;
}

function selectInput(options: [string, string][], value: string, onChange: (value: string) => void): HTMLSelectElement {
  const select = el('select', {}, ...options.map(([v, label]) => el('option', { value: v, selected: v === value }, label)));
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

function checkbox(label: string, checked: boolean, onChange: (checked: boolean) => void): HTMLElement {
  const input = el('input', { type: 'checkbox', checked });
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { className: 'checkbox' }, input, label);
}

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  return el('button', { className: primary ? 'primary' : 'secondary', onclick: onClick }, label);
}
