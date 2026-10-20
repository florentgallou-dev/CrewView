// Libellés et couleurs des statuts, communs à la scène et à la barre latérale.

import type { AgentStatus } from '../types';

export const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: '#9aa0a6',
  thinking: '#8b6cf0',
  reading: '#3d8ee0',
  writing: '#19a979',
  running: '#e8a33b',
  delegating: '#e8743b',
  asking: '#d64550',
  talking: '#13a4b4',
  done: '#19a979',
};

export const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: 'Disponible',
  thinking: 'Réfléchit',
  reading: 'Lit',
  writing: 'Écrit',
  running: 'Exécute',
  delegating: 'Délègue',
  asking: 'Attend votre réponse',
  talking: 'Parle',
  done: 'Terminé',
};

/** Durée pendant laquelle une bulle (ou une activité) est considérée comme récente. */
export const BUBBLE_TTL_MS = 10_000;
