import { createLogger } from '@AiDigital-com/design-system/logger';
import { supabase } from './supabase.js';

export const log = createLogger(supabase, 'campaign-optimizer');
