// Lecture incrémentale d'un fichier JSONL en cours d'écriture.

import * as fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

export class JsonlTailer {
  private position = 0;
  private partial = '';
  private decoder = new StringDecoder('utf8');

  constructor(readonly file: string) {}

  /** Vrai si le fichier a raccourci depuis la dernière lecture (réécrit ou remplacé). */
  shrank(): boolean {
    try {
      return fs.statSync(this.file).size < this.position;
    } catch {
      return false;
    }
  }

  /** Enregistrements ajoutés depuis le dernier appel (lignes invalides ignorées). */
  readNew(): unknown[] {
    let fd: number | undefined;
    try {
      const { size } = fs.statSync(this.file);
      if (size < this.position) this.reset();
      if (size === this.position) return [];
      fd = fs.openSync(this.file, 'r');
      const buffer = Buffer.alloc(size - this.position);
      const read = fs.readSync(fd, buffer, 0, buffer.length, this.position);
      this.position += read;
      const lines = (this.partial + this.decoder.write(buffer.subarray(0, read))).split('\n');
      this.partial = lines.pop() ?? '';
      return lines.flatMap((line) => {
        if (!line.trim()) return [];
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
    } catch {
      return [];
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }

  private reset(): void {
    this.position = 0;
    this.partial = '';
    this.decoder = new StringDecoder('utf8');
  }
}
