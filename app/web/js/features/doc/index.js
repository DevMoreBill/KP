import { CoverThumb } from './cover-thumb.js';
import { DesignMouse } from './design-mouse.js';
import { DocImages } from './doc-images.js';
import { DocxWriter } from './docx-writer.js';
import { KpDocx } from './kp-docx.js';
import { KpFile } from './kp-file.js';
import { KpModels } from './kp-models.js';
import { KpPreview } from './kp-preview.js';
import { KpSave } from './kp-save.js';
import { PdfExport } from './pdf-export.js';
import { PreviewDocx } from './preview-docx.js';
import { TemplateDesigner } from './template-designer.js';
import { TemplateEditor } from './template-editor.js';
import { TemplateFields } from './template-fields.js';
import { Templates } from './templates.js';
import { Translit } from './translit.js';

export const DOC = {
  CoverThumb,
  DocImages,
  DocxWriter,
  KpDocx,
  KpFile,
  KpModels,
  KpPreview,
  KpSave,
  PdfExport,
  PreviewDocx,
  TemplateDesigner,
  TemplateEditor,
  TemplateFields,
  Templates,
  Translit,
};

// мост для файлов интерфейса, ещё не переведённых в ES-модули
Object.assign(globalThis, DOC);

Templates.listen();
TemplateEditor.listen();
CoverThumb.listen();
PdfExport.listen();
KpPreview.listen();
DesignMouse.listen();
LISTS.ready(TemplateFields.LISTS);
