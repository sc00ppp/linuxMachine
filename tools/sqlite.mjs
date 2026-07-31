import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * A deliberately small, read-only SQLite reader.
 *
 * It supports the table b-trees and scalar record types used by this repo's
 * importers. It does not implement SQL, indexes, write-ahead logs, or any
 * mutation path.
 */
export class ReadOnlySqlite {
  constructor(buffer, label = 'SQLite database') {
    this.buffer = buffer;
    this.label = label;
    if (buffer.subarray(0, 16).toString('binary') !== 'SQLite format 3\0') {
      throw new Error(`${label} is not a SQLite 3 database.`);
    }

    const encodedPageSize = buffer.readUInt16BE(16);
    this.pageSize = encodedPageSize === 1 ? 65536 : encodedPageSize;
    this.usableSize = this.pageSize - buffer[20];
    this.textEncoding = buffer.readUInt32BE(56) || 1;
    this.tables = new Map();

    for (const { values } of this.readBtree(1)) {
      if (values[0] !== 'table' || !values[1] || !values[3]) continue;
      this.tables.set(String(values[1]), Number(values[3]));
    }
  }

  static async open(filePath) {
    return new ReadOnlySqlite(
      await fs.readFile(filePath),
      path.basename(filePath),
    );
  }

  table(name) {
    const rootPage = this.tables.get(name);
    if (!rootPage) throw new Error(`${this.label} has no ${name} table.`);
    return this.readBtree(rootPage);
  }

  page(pageNumber) {
    const start = (pageNumber - 1) * this.pageSize;
    const end = start + this.pageSize;
    if (pageNumber < 1 || end > this.buffer.length) {
      throw new Error(`${this.label} references invalid page ${pageNumber}.`);
    }
    return this.buffer.subarray(start, end);
  }

  readVarint(buffer, start) {
    let value = 0n;
    for (let index = 0; index < 8; index += 1) {
      const byte = buffer[start + index];
      value = (value << 7n) | BigInt(byte & 0x7f);
      if ((byte & 0x80) === 0) return [Number(value), index + 1];
    }
    value = (value << 8n) | BigInt(buffer[start + 8]);
    return [Number(value), 9];
  }

  readSignedInteger(buffer, start, byteCount) {
    let value = 0n;
    for (let index = 0; index < byteCount; index += 1) {
      value = (value << 8n) | BigInt(buffer[start + index]);
    }
    const bits = BigInt(byteCount * 8);
    if (value & (1n << (bits - 1n))) value -= 1n << bits;
    return Number(value);
  }

  decodeText(bytes) {
    if (this.textEncoding === 2) return bytes.toString('utf16le');
    if (this.textEncoding === 3) {
      const swapped = Buffer.allocUnsafe(bytes.length);
      for (let index = 0; index < bytes.length; index += 2) {
        swapped[index] = bytes[index + 1];
        swapped[index + 1] = bytes[index];
      }
      return swapped.toString('utf16le');
    }
    return bytes.toString('utf8');
  }

  decodeRecord(payload) {
    const [headerSize, headerVarintSize] = this.readVarint(payload, 0);
    const serialTypes = [];
    let headerOffset = headerVarintSize;
    while (headerOffset < headerSize) {
      const [serialType, length] = this.readVarint(payload, headerOffset);
      serialTypes.push(serialType);
      headerOffset += length;
    }

    let valueOffset = headerSize;
    return serialTypes.map((serialType) => {
      if (serialType === 0) return null;
      if (serialType >= 1 && serialType <= 6) {
        const byteCount = [0, 1, 2, 3, 4, 6, 8][serialType];
        const value = this.readSignedInteger(payload, valueOffset, byteCount);
        valueOffset += byteCount;
        return value;
      }
      if (serialType === 7) {
        const value = payload.readDoubleBE(valueOffset);
        valueOffset += 8;
        return value;
      }
      if (serialType === 8) return 0;
      if (serialType === 9) return 1;
      if (serialType === 10 || serialType === 11) {
        throw new Error(`${this.label} contains a reserved SQLite serial type.`);
      }

      const byteCount =
        serialType % 2 === 0
          ? (serialType - 12) / 2
          : (serialType - 13) / 2;
      const bytes = payload.subarray(valueOffset, valueOffset + byteCount);
      valueOffset += byteCount;
      return serialType % 2 === 0 ? Buffer.from(bytes) : this.decodeText(bytes);
    });
  }

  readCellPayload(pageBuffer, cellOffset, payloadSize, cellHeaderSize) {
    const maxLocal = this.usableSize - 35;
    let localSize = payloadSize;
    if (payloadSize > maxLocal) {
      const minLocal = Math.floor(((this.usableSize - 12) * 32) / 255) - 23;
      const candidate =
        minLocal + ((payloadSize - minLocal) % (this.usableSize - 4));
      localSize = candidate <= maxLocal ? candidate : minLocal;
    }

    const chunks = [
      pageBuffer.subarray(
        cellOffset + cellHeaderSize,
        cellOffset + cellHeaderSize + localSize,
      ),
    ];
    let remaining = payloadSize - localSize;
    let overflowPage =
      remaining > 0
        ? pageBuffer.readUInt32BE(cellOffset + cellHeaderSize + localSize)
        : 0;

    while (remaining > 0) {
      const overflow = this.page(overflowPage);
      overflowPage = overflow.readUInt32BE(0);
      const chunkSize = Math.min(remaining, this.usableSize - 4);
      chunks.push(overflow.subarray(4, 4 + chunkSize));
      remaining -= chunkSize;
    }

    return Buffer.concat(chunks, payloadSize);
  }

  readBtree(rootPage) {
    const rows = [];
    const visited = new Set();
    const walk = (pageNumber) => {
      if (visited.has(pageNumber)) {
        throw new Error(`${this.label} contains a cyclic b-tree.`);
      }
      visited.add(pageNumber);

      const pageBuffer = this.page(pageNumber);
      const base = pageNumber === 1 ? 100 : 0;
      const type = pageBuffer[base];
      const cellCount = pageBuffer.readUInt16BE(base + 3);
      const headerSize = type === 0x05 ? 12 : 8;

      if (type === 0x05) {
        for (let index = 0; index < cellCount; index += 1) {
          const cellOffset = pageBuffer.readUInt16BE(
            base + headerSize + index * 2,
          );
          walk(pageBuffer.readUInt32BE(cellOffset));
        }
        walk(pageBuffer.readUInt32BE(base + 8));
        return;
      }

      if (type !== 0x0d) {
        throw new Error(
          `${this.label} uses unsupported b-tree page type 0x${type.toString(16)}.`,
        );
      }

      for (let index = 0; index < cellCount; index += 1) {
        const cellOffset = pageBuffer.readUInt16BE(
          base + headerSize + index * 2,
        );
        const [payloadSize, payloadVarintSize] = this.readVarint(
          pageBuffer,
          cellOffset,
        );
        const [rowid, rowidVarintSize] = this.readVarint(
          pageBuffer,
          cellOffset + payloadVarintSize,
        );
        const cellHeaderSize = payloadVarintSize + rowidVarintSize;
        const payload = this.readCellPayload(
          pageBuffer,
          cellOffset,
          payloadSize,
          cellHeaderSize,
        );
        rows.push({ rowid, values: this.decodeRecord(payload) });
      }
    };

    walk(rootPage);
    return rows;
  }
}

export default ReadOnlySqlite;
