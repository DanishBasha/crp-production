import React from 'react';
import { AlertTriangle, X, PlusCircle, ArrowRight } from 'lucide-react';
import { useBackHandler } from '../../hooks/useBackHandler';

export interface MissingDataAlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  missingItems: Array<{
    type: 'department' | 'program' | 'class' | 'student';
    name: string;
  }>;
  onAction?: () => void;
  actionLabel?: string;
}

export const MissingDataAlertModal: React.FC<MissingDataAlertModalProps> = ({
  isOpen,
  onClose,
  title = 'Data Not Available In System',
  missingItems,
  onAction,
  actionLabel = 'Add Missing Data First'
}) => {
  useBackHandler(isOpen, onClose);

  if (!isOpen) return null;

  const depts = missingItems.filter(i => i.type === 'department');
  const progs = missingItems.filter(i => i.type === 'program');
  const classes = missingItems.filter(i => i.type === 'class');
  const students = missingItems.filter(i => i.type === 'student');

  return (
    <div className="fixed inset-0 z-60 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white border-2 border-amber-300 dark:border-amber-500 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 text-neutral-900">
        
        {/* Header */}
        <div className="bg-amber-50 border-b border-amber-200 p-5 flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-11 h-11 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-sm shrink-0">
              <AlertTriangle className="w-6 h-6 stroke-[2.2]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-amber-950 leading-snug">{title}</h3>
              <p className="text-xs text-amber-800 font-medium mt-0.5">Validation Alert: Pre-requisite entities are missing</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-amber-800/70 hover:text-amber-950 hover:bg-amber-100/80 rounded-full transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 text-xs">
          <p className="text-neutral-700 leading-relaxed font-medium">
            The uploaded Excel / CSV contains referenced entities that <strong className="text-neutral-950">do not currently exist in your institution directory</strong>. Please first add these required items to the platform before proceeding:
          </p>

          <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
            {depts.length > 0 && (
              <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3.5 space-y-2">
                <div className="text-[11px] font-bold text-rose-950 uppercase tracking-wide flex items-center space-x-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  <span>Missing Departments ({depts.length})</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {depts.map((d, idx) => (
                    <span key={idx} className="px-2.5 py-1 bg-white border border-rose-300 text-rose-900 font-semibold rounded-lg text-[11px] shadow-2xs">
                      {d.name}
                    </span>
                  ))}
                </div>
                <p className="text-[10px] text-rose-700 font-medium">Please first create these departments under Academic Departments tab.</p>
              </div>
            )}

            {progs.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3.5 space-y-2">
                <div className="text-[11px] font-bold text-blue-950 uppercase tracking-wide flex items-center space-x-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  <span>Missing Programs ({progs.length})</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {progs.map((p, idx) => (
                    <span key={idx} className="px-2.5 py-1 bg-white border border-blue-300 text-blue-900 font-semibold rounded-lg text-[11px] shadow-2xs">
                      {p.name}
                    </span>
                  ))}
                </div>
                <p className="text-[10px] text-blue-700 font-medium">Please first configure these programs under Training Programs.</p>
              </div>
            )}

            {classes.length > 0 && (
              <div className="bg-purple-50 border border-purple-200 rounded-2xl p-3.5 space-y-2">
                <div className="text-[11px] font-bold text-purple-950 uppercase tracking-wide flex items-center space-x-1.5">
                  <span className="w-2 h-2 rounded-full bg-purple-500" />
                  <span>Missing Classes / Sections ({classes.length})</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {classes.map((c, idx) => (
                    <span key={idx} className="px-2.5 py-1 bg-white border border-purple-300 text-purple-900 font-semibold rounded-lg text-[11px] shadow-2xs">
                      {c.name}
                    </span>
                  ))}
                </div>
                <p className="text-[10px] text-purple-700 font-medium">Please first add these classes under Department Classes.</p>
              </div>
            )}

            {students.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 space-y-2">
                <div className="text-[11px] font-bold text-amber-950 uppercase tracking-wide flex items-center space-x-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  <span>Unregistered Students ({students.length})</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {students.slice(0, 10).map((s, idx) => (
                    <span key={idx} className="px-2.5 py-1 bg-white border border-amber-300 text-amber-900 font-semibold rounded-lg text-[11px] shadow-2xs">
                      {s.name}
                    </span>
                  ))}
                  {students.length > 10 && (
                    <span className="px-2 py-1 text-[11px] text-amber-800 font-medium">
                      +{students.length - 10} more
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-amber-700 font-medium">These students must be enrolled before they can receive assignments.</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-neutral-50 border-t border-neutral-100 flex items-center justify-end space-x-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-neutral-300 hover:bg-neutral-100 text-neutral-700 rounded-xl text-xs font-semibold cursor-pointer transition-all"
          >
            Close
          </button>
          {onAction && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onAction();
              }}
              className="px-5 py-2 bg-neutral-900 hover:bg-black text-white rounded-xl text-xs font-bold shadow-sm flex items-center space-x-1.5 cursor-pointer transition-all"
            >
              <span>{actionLabel}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

      </div>
    </div>
  );
};
