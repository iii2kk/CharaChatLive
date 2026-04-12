"use client";

interface MenuWindowProps {
  windows: Array<{ id: string; label: string; visible: boolean }>;
  onToggle: (id: string) => void;
}

export default function MenuWindow({ windows, onToggle }: MenuWindowProps) {
  return (
    <div className="flex flex-col gap-1 min-w-[160px]">
      {windows.map((w) => (
        <button
          key={w.id}
          type="button"
          onClick={() => onToggle(w.id)}
          className={`text-left px-3 py-1.5 rounded text-sm transition-colors ${
            w.visible
              ? "bg-blue-700/60 text-blue-100 hover:bg-blue-600/60"
              : "bg-gray-800 text-gray-300 hover:bg-gray-700"
          }`}
        >
          {w.label}
        </button>
      ))}
    </div>
  );
}
