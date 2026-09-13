import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** A versioned room document lets joins and race starts use atomic D1 writes. */
export const raceRooms = sqliteTable('race_rooms', {
  code: text('code').primaryKey(),
  data: text('data').notNull(),
  version: integer('version').notNull().default(1),
  expiresAt: integer('expires_at').notNull(),
}, (table) => [index('race_rooms_expiry_idx').on(table.expiresAt)]);
