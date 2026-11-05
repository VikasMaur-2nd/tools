/**
 * Huge mode's stream worker (client.ts starts it, lazily): whole-document commands, the Shape pass and .gz
 * decompression, apart from the index's worker so browsing stays quick while they run.
 */
import { serve } from './serve';

serve(self as unknown as Parameters<typeof serve>[0]);
