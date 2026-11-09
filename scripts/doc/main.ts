import { runDoc } from './cli.ts'

process.exit(await runDoc(process.argv.slice(2)))
