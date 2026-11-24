import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutLabels, type LabelRequest } from '../src/webview/labels';

const label = (id: string, owner: string, kind: LabelRequest['kind'], depth: number, x: number, y: number): LabelRequest => ({ id, owner, kind, depth, x, y, width: 60, height: 16 });

test('une étiquette libre reste à sa place', () => {
  const offsets = layoutLabels([label('n', 'a', 'name', 1, 0, 0)], []);
  assert.deepEqual(offsets.get('n'), { dx: 0, dy: 0 });
});

test('l’agent de devant garde sa place, celui de derrière s’écarte', () => {
  const offsets = layoutLabels([label('fond', 'a', 'name', 1, 10, 0), label('devant', 'b', 'name', 5, 0, 0)], []);
  assert.deepEqual(offsets.get('devant'), { dx: 0, dy: 0 });
  const moved = offsets.get('fond')!;
  assert.ok(moved.dx !== 0 || moved.dy !== 0);
  // Plus de chevauchement : écart vertical d'au moins la hauteur, ou horizontal d'au moins la largeur.
  assert.ok(Math.abs(moved.dy) >= 16 || Math.abs(10 + moved.dx) >= 60);
});

test('un nom évite la silhouette d’un autre agent, pas la sienne', () => {
  const head = { left: 0, right: 30, top: 0, bottom: 50 };
  const own = layoutLabels([label('n', 'a', 'name', 1, 0, 20)], [{ owner: 'a', rect: head }]);
  assert.deepEqual(own.get('n'), { dx: 0, dy: 0 });
  const other = layoutLabels([label('n', 'a', 'name', 1, 0, 20)], [{ owner: 'b', rect: head }]).get('n')!;
  assert.ok(20 + other.dy >= 50 || 20 + other.dy + 16 <= 0 || other.dx >= 30 || other.dx + 60 <= 0);
});

test('une bulle ne descend jamais : elle monte ou se décale sur le côté', () => {
  const offsets = layoutLabels([label('b1', 'a', 'bubble', 1, 0, 100), label('b2', 'b', 'bubble', 2, 0, 100)], []);
  assert.deepEqual(offsets.get('b2'), { dx: 0, dy: 0 });
  assert.ok(offsets.get('b1')!.dy <= 0);
});
