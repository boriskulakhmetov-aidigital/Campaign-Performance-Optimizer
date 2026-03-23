import { createLogger } from '@boriskulakhmetov-aidigital/design-system/logger';
import { supabase } from './supabase.js';

export const log = createLogger(supabase as any, 'campaign-optimizer');
