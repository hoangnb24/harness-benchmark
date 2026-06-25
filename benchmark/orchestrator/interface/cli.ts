import { JsonPricingProvider } from '../infrastructure/JsonPricingProvider';
import { ScoreAdherence } from '../application/ScoreAdherence';
import { FsAdherenceArtifactWriter } from '../infrastructure/FsAdherenceArtifactWriter';
import { JsonAdherenceEvidenceProvider } from '../infrastructure/JsonAdherenceEvidenceProvider';

interface CliIo {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

const defaultIo: CliIo = {
  stdout: (message) => process.stdout.write(message),
  stderr: (message) => process.stderr.write(message),
};

export async function runCli(args: string[], io: CliIo = defaultIo): Promise<number> {
  const [area, command, ...rest] = args;

  if (area === 'pricing' && command === 'validate') {
    return validatePricing(rest, io);
  }

  if (area === 'adherence' && command === 'score') {
    return scoreAdherence(rest, io);
  }

  io.stderr(
    [
      'Usage:',
      '  harness-bench pricing validate [--pricing benchmark/pricing/models.json]',
      '  harness-bench adherence score --evidence evidence.json --out adherence.json',
      '',
    ].join('\n'),
  );
  return 1;
}

async function validatePricing(args: string[], io: CliIo): Promise<number> {
  const pricingPath = readFlag(args, '--pricing') ?? 'benchmark/pricing/models.json';

  try {
    const provider = new JsonPricingProvider(pricingPath);
    const rates = await provider.allRates();
    io.stdout(`Pricing table OK: ${pricingPath}\n`);
    for (const rate of rates) {
      io.stdout(
        `${rate.model} (${rate.provider}) input=${rate.inputUsdPerMillion} cached=${rate.cachedInputUsdPerMillion} output=${rate.outputUsdPerMillion}\n`,
      );
    }
    return 0;
  } catch (error) {
    io.stderr(`Pricing table invalid: ${pricingPath}\n${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function scoreAdherence(args: string[], io: CliIo): Promise<number> {
  const evidencePath = readFlag(args, '--evidence');
  const outPath = readFlag(args, '--out');

  if (!evidencePath || !outPath) {
    io.stderr('Usage: harness-bench adherence score --evidence evidence.json --out adherence.json\n');
    return 1;
  }

  try {
    const score = await new ScoreAdherence(
      new JsonAdherenceEvidenceProvider(evidencePath),
      new FsAdherenceArtifactWriter(outPath),
    ).run();

    io.stdout(
      `Adherence scored: ${score.adherence_pass}/${score.adherence_total} -> ${outPath}\n`,
    );
    return 0;
  } catch (error) {
    io.stderr(
      `Adherence scoring failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

if (require.main === module) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
