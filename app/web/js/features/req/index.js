import { ExpertLog } from './expert-log.js';
import { ReceiverSync } from './receiver-sync.js';
import { ReqChecks } from './req-checks.js';
import { ReqForm } from './req-form.js';
import { ReqLine } from './req-line.js';
import { ReqNum } from './req-num.js';
import { StationReq } from './station-req.js';

export const REQ = { ExpertLog, ReceiverSync, ReqChecks, ReqForm, ReqLine, ReqNum, StationReq };

// мост для файлов интерфейса, ещё не переведённых в ES-модули
Object.assign(globalThis, REQ);

ReqForm.listen();
