import { defineSecret, defineString } from 'firebase-functions/params'

export const participantSecretKey = defineSecret('PARTICIPANT_SECRET_KEY')
export const bootstrapOwnerEmail = defineString('BOOTSTRAP_OWNER_EMAIL', {
  default: 'jammanbogem@gmail.com',
  description: 'Verified Google account allowed to create the initial VIBE26 owner membership.',
})

export const EVENT_ID = 'room-vibe26'
export const PUBLIC_SLUG = 'vibecoding-2026'
export const REGION = 'asia-northeast3'
export const MAX_PARTICIPANTS = 100

// Keep burst capacity above the 100-person event load while placing an
// explicit ceiling on accidental loops or abusive traffic. Concurrency 40
// still permits up to 400 simultaneous requests across ten instances.
export const FUNCTION_COST_GUARDRAILS = {
  concurrency: 40,
  maxInstances: 10,
  memory: '256MiB',
  minInstances: 0,
} as const
