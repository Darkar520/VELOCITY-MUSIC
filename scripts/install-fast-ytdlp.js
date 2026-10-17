import { installWindowsRuntime } from '../src/services/ytdlpWindowsRuntime.js';
import { YT_DLP_BIN_DIR } from '../src/extractors/ytdlp.js';

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Este instalador corresponde a Windows x64.');
}
const result = await installWindowsRuntime({ binDir: YT_DLP_BIN_DIR });
console.log(result.output);
