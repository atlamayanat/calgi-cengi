/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Perküsyon Otomasyonu — ESP32-S3 ile USB Serial üzerinden 8 kanallı solenoid kontrol.
 * 2× ULN2803A sürücü (H1..H4 Q1'de, H5..H8 Q2'de). 9 slotluk drag-drop ritim dizisi.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  Play, Trash2, RotateCcw, Volume2, VolumeX, Library, Square, Settings as SettingsIcon,
} from 'lucide-react';
import {
  DndContext, useDraggable, useDroppable,
  type DragEndEvent, DragOverlay, useSensor, useSensors,
  MouseSensor, TouchSensor, type DragStartEvent,
} from '@dnd-kit/core';

import { INSTRUMENTS, type Instrument, type InstrumentId } from './core/instruments';
import { type RhythmSlot, type Melody, MAX_SLOTS, emptySlots } from './core/melody';
import { PRESET_MELODIES, PRESET_NAMES, isPresetName } from './core/presetMelodies';
import { serialBridge, type ConnectionStatus, SerialBridge } from './core/serialBridge';
import { MelodyBrowser } from './components/MelodyBrowser';
import { SettingsPanel } from './components/SettingsPanel';

// ---------- Yardımcılar ----------

const LOCAL_MELODY_KEY = 'perkusyon_local_melodies';

// 16th-note değil, basit "vuruş başına 60/BPM saniye" zamanlama (mevcut UI mantığı)
function beatMs(bpm: number): number {
  return Math.round(60000 / bpm);
}

// ---------- Enstrüman kartı ----------

interface InstrumentCardProps {
  inst: Instrument;
  isSelected?: boolean;
  hitCount?: number;
  setHitCount?: (n: number) => void;
  duration?: number;
  setDuration?: (n: number) => void;
  isDragging?: boolean;
  isOverlay?: boolean;
  compact?: boolean;
}

function InstrumentCard({
  inst, isSelected, hitCount, setHitCount, duration, setDuration, isDragging, isOverlay, compact,
}: InstrumentCardProps) {
  // Kompakt mod: 9 sütunlu slot satırı için daha dar (ama yine dokunulabilir) yerleşim
  const sizeCls = compact
    ? 'p-2.5 md:p-3 min-h-[180px] md:min-h-[210px]'
    : 'p-3 md:p-4 min-h-[180px] md:min-h-[220px]';
  const iconBoxCls = compact ? 'p-2 md:p-2.5' : 'p-2.5 md:p-3';
  const iconCls = compact ? 'w-14 h-14 md:w-20 md:h-20' : 'w-14 h-14 md:w-20 md:h-20';
  const nameCls = compact ? 'mt-2 text-sm md:text-base' : 'mt-2 md:mt-2.5 text-sm md:text-base';
  const labelCls = compact ? 'text-[10px] md:text-xs' : 'text-[10px] md:text-xs';
  const dotCls = compact ? 'w-6 h-6 md:w-7 md:h-7' : 'w-7 h-7 md:w-8 md:h-8';
  const dotGap = compact ? 'gap-1.5 md:gap-2' : 'gap-2 md:gap-2.5';

  return (
    <div
      className={`relative flex flex-col items-center rounded-3xl transition-all border-4 h-full w-full ${sizeCls} ${inst.color} ${
        isSelected
          ? 'border-white shadow-xl scale-105 z-10'
          : 'border-transparent shadow-md opacity-90 hover:opacity-100'
      } ${isDragging ? 'opacity-30' : ''} ${isOverlay ? 'border-white shadow-2xl scale-110 cursor-grabbing' : 'cursor-grab active:cursor-grabbing'}`}
    >
      <div className={`${iconBoxCls} rounded-2xl bg-white/20 flex items-center justify-center`}>
        {typeof inst.icon === 'string' ? (
          <img
            src={inst.icon}
            alt={inst.name}
            draggable={false}
            className={`${iconCls} object-contain select-none pointer-events-none brightness-0 invert`}
          />
        ) : (
          <inst.icon className={`${iconCls} text-white`} />
        )}
      </div>
      <span className={`${nameCls} font-bold text-white text-center leading-tight`}>
        {inst.name}
      </span>

      {setHitCount && setDuration && (
        <div className="mt-auto pt-2 space-y-1.5 w-full text-center">
          <span className={`${labelCls} uppercase font-black tracking-widest text-white/80 block`}>
            {inst.id === 'WAIT' ? 'süre seç' : 'vuruş sayısı'}
          </span>
          <div className={`flex justify-center ${dotGap}`}>
            {inst.id === 'WAIT' ? (
              [500, 1000, 1500, 2000].map((ms) => (
                <button
                  key={ms}
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); setDuration(ms); }}
                  style={{ touchAction: 'manipulation' }}
                  className={`${dotCls} rounded-full border-[3px] transition-all cursor-pointer ${
                    duration !== undefined && ms <= duration ? 'bg-white border-white' : 'bg-transparent border-white/50'
                  }`}
                  title={`${ms / 1000}s`}
                />
              ))
            ) : (
              [1, 2, 3, 4].map((num) => (
                <button
                  key={num}
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); setHitCount(num); }}
                  style={{ touchAction: 'manipulation' }}
                  className={`${dotCls} rounded-full border-[3px] transition-all cursor-pointer ${
                    hitCount !== undefined && num <= hitCount ? 'bg-white border-white' : 'bg-transparent border-white/50'
                  }`}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface DraggableInstrumentProps {
  inst: Instrument;
  isSelected: boolean;
  onClick: () => void;
  hitCount: number;
  setHitCount: (n: number) => void;
  duration: number;
  setDuration: (n: number) => void;
}

function DraggableInstrument(props: DraggableInstrumentProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: props.inst.id,
    data: { type: 'instrument', instrument: props.inst.id },
  });

  return (
    <motion.div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={props.onClick}
      style={{ touchAction: 'none' }}
    >
      <InstrumentCard
        inst={props.inst}
        isSelected={props.isSelected}
        hitCount={props.hitCount}
        setHitCount={props.setHitCount}
        duration={props.duration}
        setDuration={props.setDuration}
        isDragging={isDragging}
      />
    </motion.div>
  );
}

interface DraggableSequenceItemProps {
  idx: number;
  slot: RhythmSlot;
  instData: Instrument;
  isActive: boolean;
  onUpdateSlot: (idx: number, updates: Partial<RhythmSlot>) => void;
}

function DraggableSequenceItem({ idx, slot, instData, isActive, onUpdateSlot }: DraggableSequenceItemProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `seq-item-${idx}`,
    data: { type: 'sequence-item', index: idx, instrument: slot.instrument },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ touchAction: 'none' }}
      className={`w-full h-full transition-all ${isActive ? 'scale-105 z-20' : ''} ${isDragging ? 'opacity-30' : ''}`}
    >
      <InstrumentCard
        inst={instData}
        hitCount={slot.hits}
        setHitCount={(n) => onUpdateSlot(idx, { hits: n })}
        duration={slot.duration}
        setDuration={(ms) => onUpdateSlot(idx, { duration: ms })}
        isSelected={isActive}
        compact
      />
    </div>
  );
}

interface TrashZoneProps {
  onClick: () => void;
}

function TrashZone({ onClick }: TrashZoneProps) {
  const { isOver, setNodeRef } = useDroppable({ id: 'trash-zone', data: { type: 'trash' } });

  // Sol alt köşeye sabitlenmiş, ekrandan bağımsız büyük damping bölgesi
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      aria-label="Son eklenen ritmi sil"
      className={`fixed bottom-6 left-6 md:bottom-8 md:left-8 z-30 flex flex-col items-center justify-center gap-1.5 w-32 h-32 md:w-40 md:h-40 rounded-3xl font-black text-base md:text-xl transition-all border-4 ${
        isOver
          ? 'bg-rose-600 text-white border-rose-400 scale-110 shadow-2xl'
          : 'bg-rose-500 text-white border-white shadow-[0_9px_0_rgb(190,18,60)] hover:translate-y-1 hover:shadow-[0_4px_0_rgb(190,18,60)] active:translate-y-2 active:shadow-none'
      }`}
    >
      <Trash2 className={`w-12 h-12 md:w-16 md:h-16 ${isOver ? 'animate-bounce' : ''}`} />
      SİL
    </button>
  );
}

// Enstrüman paletini droppable yapar — sekans nesnesi buraya sürüklenirse silinir
interface PaletteDropZoneProps {
  children: React.ReactNode;
}

function PaletteDropZone({ children }: PaletteDropZoneProps) {
  const { isOver, setNodeRef } = useDroppable({ id: 'palette-zone', data: { type: 'palette' } });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-[2rem] transition-all ${isOver ? 'ring-4 ring-rose-400 ring-offset-2 bg-rose-50/30' : ''}`}
    >
      {children}
    </div>
  );
}

interface DroppableSlotProps {
  idx: number;
  slot: RhythmSlot | null;
  activeSlotIndex: number | null;
  onUpdateSlot: (idx: number, updates: Partial<RhythmSlot>) => void;
}

function DroppableSlot({ idx, slot, activeSlotIndex, onUpdateSlot }: DroppableSlotProps) {
  const { isOver, setNodeRef } = useDroppable({ id: `slot-${idx}`, data: { index: idx } });
  const instData = slot ? INSTRUMENTS.find((i) => i.id === slot.instrument) ?? null : null;
  const isActive = activeSlotIndex === idx;

  if (slot && instData) {
    return (
      <div ref={setNodeRef} className="relative w-full h-full">
        <DraggableSequenceItem idx={idx} slot={slot} instData={instData} isActive={isActive} onUpdateSlot={onUpdateSlot} />
        {isActive && (
          <motion.div
            layoutId="active-glow"
            className="absolute inset-0 bg-white/30 rounded-3xl animate-pulse pointer-events-none z-30"
          />
        )}
        {isOver && (
          <div className="absolute inset-0 border-4 border-dashed border-indigo-400 bg-indigo-50/50 rounded-3xl z-40 pointer-events-none" />
        )}
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={`relative w-full h-full min-h-[180px] md:min-h-[210px] rounded-3xl border-4 transition-all flex items-center justify-center ${
        isOver ? 'border-dashed border-indigo-400 bg-indigo-50/50 scale-105' : 'border-white bg-white/40 shadow-inner'
      }`}
    >
      <div className="w-12 h-12 rounded-2xl border-4 border-white/40 flex items-center justify-center text-white/40 font-black text-lg">
        {idx + 1}
      </div>
    </div>
  );
}

// ---------- Ana uygulama ----------

export default function App() {
  // Sekans ve enstrüman parametre durumları
  const [sequence, setSequence] = useState<(RhythmSlot | null)[]>(() => emptySlots());
  const [selectedInst, setSelectedInst] = useState<InstrumentId>('BD1');
  const [hitCounts, setHitCounts] = useState<Record<InstrumentId, number>>(() =>
    Object.fromEntries(INSTRUMENTS.map((i) => [i.id, i.id === 'WAIT' ? 0 : 1])) as Record<InstrumentId, number>,
  );
  const [durations, setDurations] = useState<Record<InstrumentId, number>>(() =>
    Object.fromEntries(INSTRUMENTS.map((i) => [i.id, i.id === 'WAIT' ? 500 : 0])) as Record<InstrumentId, number>,
  );

  // Çalma durumu
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeSlotIndex, setActiveSlotIndex] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const stopRequested = useRef(false);

  // Tasarım parametreleri
  const [bpm, setBpm] = useState(120);
  const [isMuted, setIsMuted] = useState(false);
  const [activeId, setActiveId] = useState<InstrumentId | null>(null);

  // Donanım bağlantı durumu
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('disconnected');
  const [connMessage, setConnMessage] = useState<string | undefined>();
  const [isReady, setIsReady] = useState(false);

  // Melodi kütüphanesi
  const [browserOpen, setBrowserOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deviceMelodyList, setDeviceMelodyList] = useState<string[]>([]);
  const [localMelodies, setLocalMelodies] = useState<Record<string, Melody>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = localStorage.getItem(LOCAL_MELODY_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  const persistLocalMelodies = (next: Record<string, Melody>) => {
    setLocalMelodies(next);
    try { localStorage.setItem(LOCAL_MELODY_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  // Preset + Yerel + Cihaz — birleşik UI listesi. Preset'ler her zaman başta, sabit sırada.
  const melodyList = useMemo(() => {
    const custom = new Set<string>([...Object.keys(localMelodies), ...deviceMelodyList]);
    // Preset'ler kullanıcı listesinden ayıklanır ki iki kez görünmesin
    for (const p of PRESET_NAMES) custom.delete(p);
    return [...PRESET_NAMES, ...Array.from(custom).sort()];
  }, [localMelodies, deviceMelodyList]);

  // Mouse + Touch sensörleri ayrı yapılandırılır — dokunmatik için delay/tolerance kritik
  // (delay: parmak basılı kalma süresi → sayfanın scroll/zoom'unu engellemeden drag başlar)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
  );

  // ---- Sergi/Kiosk kilidi ----
  // Uzun-basma menüsü ve sağ-tık ziyaretçilerin tarayıcıdan oyunu kapatmasına izin verir.
  // Burada bağlam menüsünü, metin seçimini ve yenileme/çıkış kısayollarını engelliyoruz.
  useEffect(() => {
    const blockContext = (e: Event) => e.preventDefault();
    const blockKeys = (e: KeyboardEvent) => {
      // F5/Ctrl+R: yenileme; Ctrl+W: sekme kapat; F11: tam-ekran çıkış; Ctrl+P: yazdır; Alt+Home: ana sayfa
      // NOT: Alt+F4 KASITLI olarak engellenmez — yetkili personelin klavyeden tek çıkış yoludur.
      const k = e.key;
      const ctrl = e.ctrlKey || e.metaKey;
      if (
        k === 'F5' || k === 'F11' ||
        (ctrl && (k === 'r' || k === 'R' || k === 'w' || k === 'W' || k === 'p' || k === 'P')) ||
        (e.altKey && k === 'Home')
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('contextmenu', blockContext);
    window.addEventListener('keydown', blockKeys, true);
    return () => {
      window.removeEventListener('contextmenu', blockContext);
      window.removeEventListener('keydown', blockKeys, true);
    };
  }, []);

  // ---- Serial bridge yaşam döngüsü ----
  useEffect(() => {
    const off = serialBridge.on((ev) => {
      if (ev.type === 'status') {
        setConnStatus(ev.status);
        setConnMessage(ev.message);
        if (ev.status !== 'connected') setIsReady(false);
      } else if (ev.type === 'ready') {
        setIsReady(true);
        // Hazır olunca mevcut melodi listesini iste
        serialBridge.listMelodies().catch(() => {});
      } else if (ev.type === 'message') {
        if (ev.line.startsWith('LIST:')) {
          const csv = ev.line.slice(5);
          setDeviceMelodyList(csv.length > 0 ? csv.split(',').filter(Boolean) : []);
        } else if (ev.line.startsWith('SAVED:') || ev.line.startsWith('DELETED:')) {
          serialBridge.listMelodies().catch(() => {});
        }
      }
    });
    // Daha önce yetkilendirilmiş portu sessizce aç (sistem başlatıldığında)
    serialBridge.tryAutoConnect().catch(() => {});
    // 3 sn'de bir sürekli — kiosk yeniden açıldığında / USB geç enumere olduğunda kendiliğinden bağlansın
    const tick = setInterval(() => {
      if (serialBridge.getStatus() === 'connected' || serialBridge.getStatus() === 'connecting') return;
      serialBridge.tryAutoConnect().catch(() => {});
    }, 3000);
    return () => { off(); clearInterval(tick); };
  }, []);

  // ---- Tarayıcı içi ön-izleme tonu (donanımsız test için) ----
  const playPreviewSound = useCallback((freq: number, hits: number) => {
    if (isMuted || freq === 0 || typeof window === 'undefined') return;
    type AudioContextCtor = typeof AudioContext;
    const Ctor: AudioContextCtor | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!Ctor) return;
    const audioCtx = new Ctor();
    const now = audioCtx.currentTime;
    const beat = beatMs(bpm) / 1000;
    for (let i = 0; i < hits; i++) {
      const t = now + i * beat;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = freq > 500 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    }
  }, [isMuted, bpm]);

  // Çiftli enstrümanlarda ardışık vuruşlar iki solenoid arasında dönüşümlü tetiklenir.
  // Sayaç playback başında sıfırlanır (handlePlay); manuel tıklamalarda da dönüşüm
  // sürer ki tek solenoid aşırı yorulmasın.
  const rotationRef = useRef<Record<InstrumentId, number>>({} as Record<InstrumentId, number>);

  // Bir vuruş = ESP32 HIT komutu + opsiyonel ön-izleme tonu
  const fireHit = useCallback((inst: Instrument) => {
    if (inst.channels.length > 0) {
      const idx = rotationRef.current[inst.id] ?? 0;
      const ch = inst.channels[idx % inst.channels.length];
      rotationRef.current[inst.id] = idx + 1;
      serialBridge.hit(ch).catch(() => {});
    }
    playPreviewSound(inst.soundFreq, 1);
  }, [playPreviewSound]);

  // ---- Sekans manipülasyonu ----
  // Tıklamayla ekleme: son dolu slot ile aynı enstrüman ise vuruşu arttır (merge),
  // farklı enstrüman veya slot boşsa yeni slota 1 vuruş olarak ekle.
  // Sürükle-bırak bu yolu kullanmaz → ayrı nesneler olarak eklenir (handleDragEnd içinde).
  const handleAddToSequence = (instId?: InstrumentId) => {
    const id = instId ?? selectedInst;
    const inst = INSTRUMENTS.find((i) => i.id === id)!;
    const lastIdx = sequence.reduce((acc, s, i) => (s !== null ? i : acc), -1);
    const last = lastIdx >= 0 ? sequence[lastIdx] : null;

    // Son slot aynı enstrüman (ve WAIT değil) + vuruş limiti aşılmıyorsa birleştir
    if (last && last.instrument === id && id !== 'WAIT' && last.hits < 4) {
      const next = [...sequence];
      next[lastIdx] = { ...last, hits: last.hits + 1 };
      setSequence(next);
      fireHit(inst);
      return;
    }

    // Yeni slot olarak ekle — son dolu slotun bir sonrasına
    const targetIdx = lastIdx + 1;
    if (targetIdx >= MAX_SLOTS) return;
    const next = [...sequence];
    next[targetIdx] = {
      instrument: id,
      hits: id === 'WAIT' ? 0 : 1,
      duration: id === 'WAIT' ? durations[id] : undefined,
    };
    setSequence(next);
    if (id !== 'WAIT') fireHit(inst);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as { type?: string; instrument?: InstrumentId } | undefined;
    if (data?.type === 'instrument') setActiveId(event.active.id as InstrumentId);
    else if (data?.type === 'sequence-item') setActiveId(data.instrument ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const aData = active.data.current as { type?: string; instrument?: InstrumentId; index?: number } | undefined;
    const oData = over.data.current as { type?: string; index?: number } | undefined;

    if (aData?.type === 'instrument') {
      if (oData?.type === 'trash') return;
      if (oData?.index === undefined) return;
      const instId = aData.instrument as InstrumentId;
      const inst = INSTRUMENTS.find((i) => i.id === instId)!;
      const next = [...sequence];
      next[oData.index] = {
        instrument: instId,
        hits: instId === 'WAIT' ? 0 : hitCounts[instId],
        duration: instId === 'WAIT' ? durations[instId] : undefined,
      };
      setSequence(next);
      if (inst.id !== 'WAIT') fireHit(inst);
    } else if (aData?.type === 'sequence-item' && aData.index !== undefined) {
      const sourceIndex = aData.index;
      if (oData?.type === 'trash' || oData?.type === 'palette') {
        const next = [...sequence];
        next[sourceIndex] = null;
        setSequence(next);
      } else if (oData?.index !== undefined && sourceIndex !== oData.index) {
        const next = [...sequence];
        const tmp = next[sourceIndex];
        next[sourceIndex] = next[oData.index];
        next[oData.index] = tmp;
        setSequence(next);
      }
    }
  };

  const handleUpdateSlot = (idx: number, updates: Partial<RhythmSlot>) => {
    setSequence((prev) => {
      const next = [...prev];
      if (next[idx]) next[idx] = { ...next[idx]!, ...updates };
      return next;
    });
  };

  const handleClear = () => {
    if (isPlaying) stopRequested.current = true;
    setSequence(emptySlots());
  };

  // Son eklenen ritim slotunu siler (SİL alanına tıklanınca)
  const handleDeleteLast = () => {
    setSequence((prev) => {
      const lastIdx = prev.reduce((acc, s, i) => (s !== null ? i : acc), -1);
      if (lastIdx === -1) return prev;
      const next = [...prev];
      next[lastIdx] = null;
      return next;
    });
  };

  // ---- Çalma motoru ----
  // Slot tabanlı sekansı, her vuruşu tek tek HIT komutuyla ESP32'ye gönderir.
  // (SEQ komutu sabit-uzunluk binary maskesi gerektirdiği için bu UI modeli ile uyumsuz —
  //  bu yüzden gerçek-zamanlı HIT modu kullanılıyor.)
  const handlePlay = async () => {
    if (isPlaying) return;
    stopRequested.current = false;
    setIsPlaying(true);
    setProgress(0);
    // Her playback'i aynı solenoidden başlat (çiftli enstrümanlar için deterministik)
    rotationRef.current = {} as Record<InstrumentId, number>;

    let totalBeats = 0;
    for (const slot of sequence) {
      if (!slot) continue;  // Boş slotları atla — arada/başta boşluk olsa bile dolu slotlar art arda çalar
      totalBeats += slot.instrument === 'WAIT'
        ? Math.max(1, Math.round((slot.duration ?? 500) / beatMs(bpm)))
        : slot.hits;
    }
    if (totalBeats === 0) totalBeats = 1;

    const interval = beatMs(bpm);
    let beatIdx = 0;

    for (let i = 0; i < MAX_SLOTS; i++) {
      if (stopRequested.current) break;
      const slot = sequence[i];
      if (!slot) continue;  // Boşluğa takılma, bir sonraki dolu slota geç
      setActiveSlotIndex(i);
      const inst = INSTRUMENTS.find((ins) => ins.id === slot.instrument);
      if (!inst) continue;

      if (inst.id === 'WAIT') {
        const waitBeats = Math.max(1, Math.round((slot.duration ?? 500) / interval));
        for (let w = 0; w < waitBeats; w++) {
          if (stopRequested.current) break;
          beatIdx++;
          setProgress((beatIdx / totalBeats) * 100);
          await new Promise((r) => setTimeout(r, interval));
        }
      } else {
        for (let h = 0; h < slot.hits; h++) {
          if (stopRequested.current) break;
          fireHit(inst);
          beatIdx++;
          setProgress((beatIdx / totalBeats) * 100);
          await new Promise((r) => setTimeout(r, interval));
        }
      }
    }

    setActiveSlotIndex(null);
    setIsPlaying(false);
    serialBridge.stop().catch(() => {});  // ESP32'de bekleyen sekans varsa temizle
    setTimeout(() => setProgress(0), 400);
  };

  const handleStop = () => {
    stopRequested.current = true;
    serialBridge.stop().catch(() => {});
  };

  // ---- Bağlantı kontrolleri ----
  const onConnect = () => { serialBridge.connect().catch(() => {}); };
  const onDisconnect = () => { serialBridge.disconnect().catch(() => {}); };
  const onCancelConnect = async () => {
    await serialBridge.disconnect().catch(() => {});
    await serialBridge.forgetAllPorts().catch(() => {});
    setConnStatus('disconnected');
    setIsReady(false);
  };

  // ---- Melodi kütüphanesi olayları ----
  const currentMelody: Melody = useMemo(
    () => ({ name: 'aktif', bpm, slots: sequence }),
    [bpm, sequence],
  );

  const handleSaveMelody = (name: string) => {
    const next = { ...localMelodies, [name]: { name, bpm, slots: sequence } };
    persistLocalMelodies(next);
    if (isConnected) serialBridge.saveMelody(name).catch(() => {});
  };
  const handleLoadMelody = (name: string) => {
    // Preset'ler kodda gömülü; yerel veya cihaz aramadan önce kontrol edilir
    if (isPresetName(name)) {
      const preset = PRESET_MELODIES[name];
      setBpm(preset.bpm);
      setSequence([...preset.slots.slice(0, MAX_SLOTS), ...emptySlots()].slice(0, MAX_SLOTS));
      return;
    }
    const local = localMelodies[name];
    if (local) {
      setBpm(local.bpm);
      setSequence([...local.slots.slice(0, MAX_SLOTS), ...emptySlots()].slice(0, MAX_SLOTS));
    } else if (isConnected) {
      serialBridge.loadMelody(name).catch(() => {});
    }
  };
  const handleDeleteMelody = (name: string) => {
    if (localMelodies[name]) {
      const next = { ...localMelodies };
      delete next[name];
      persistLocalMelodies(next);
    }
    if (isConnected) serialBridge.deleteMelody(name).catch(() => {});
  };
  const handleRefresh = () => { serialBridge.listMelodies().catch(() => {}); };

  // ---- Render ----
  const isConnected = connStatus === 'connected' && isReady;
  const hasAnySlot = sequence.some((s) => s !== null);

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div
        className="h-screen overflow-hidden px-3 md:px-6 pt-4 md:pt-6 pb-4 md:pb-6 font-sans text-slate-800 flex flex-col bg-cover bg-center bg-no-repeat bg-fixed"
        style={{ backgroundImage: 'url(/background.png)' }}
      >

        <div className="w-full max-w-[1500px] mx-auto space-y-4 md:space-y-6 flex-1 flex flex-col">

          {/* Üst şerit: sol — ayarlar, orta — başlık, sağ — sessize alma */}
          <header className="flex items-center gap-3 md:gap-4">
            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={() => setSettingsOpen(true)}
              aria-label="Ayarlar"
              className="flex items-center justify-center w-14 h-14 md:w-16 md:h-16 rounded-3xl bg-white text-slate-700 border-4 border-white shadow-[0_6px_0_rgb(203,213,225)] hover:translate-y-1 hover:shadow-[0_3px_0_rgb(203,213,225)] active:translate-y-2 active:shadow-none transition-all shrink-0"
            >
              <SettingsIcon className="w-7 h-7 md:w-8 md:h-8" />
            </motion.button>

            {/* Renkli başlık — Fredoka fontu, beyaz kart arka plan, neumorfik gölge */}
            <h1
              className="flex-1 text-center text-lg md:text-2xl lg:text-3xl tracking-wide bg-white/85 backdrop-blur-md border-4 border-white rounded-3xl px-4 md:px-8 py-2.5 md:py-3 shadow-[0_6px_0_rgba(203,213,225,0.7)]"
              style={{ fontFamily: "'Fredoka', system-ui, sans-serif", fontWeight: 700 }}
            >
              <span className="text-emerald-500">SÜRÜKLE</span>
              <span className="text-slate-400 mx-1.5 md:mx-2">·</span>
              <span className="text-sky-500">BİRLEŞTİR</span>
              <span className="text-slate-400 mx-1.5 md:mx-2">·</span>
              <span className="text-amber-500">MÜZİĞİNİ</span>
              <span className="text-slate-400 mx-1.5 md:mx-2">·</span>
              <span className="text-rose-500">GELİŞTİR</span>
            </h1>

            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={() => setIsMuted(!isMuted)}
              aria-label={isMuted ? 'Sesi aç' : 'Sesi kapat'}
              className="flex items-center justify-center w-14 h-14 md:w-16 md:h-16 rounded-3xl bg-white text-slate-700 border-4 border-white shadow-[0_6px_0_rgb(203,213,225)] hover:translate-y-1 hover:shadow-[0_3px_0_rgb(203,213,225)] active:translate-y-2 active:shadow-none transition-all shrink-0"
            >
              {isMuted
                ? <VolumeX className="w-7 h-7 md:w-8 md:h-8 text-rose-500" />
                : <Volume2 className="w-7 h-7 md:w-8 md:h-8 text-sky-500" />}
            </motion.button>
          </header>

          {/* Enstrüman seçimi (7 kart) — küçük ekranda 4 kolon, geniş ekranda tek sıra */}
          <PaletteDropZone>
            <section className="grid grid-cols-4 md:grid-cols-7 gap-2 md:gap-3 pt-6 md:pt-10">
              {INSTRUMENTS.map((inst) => (
                <DraggableInstrument
                  key={inst.id}
                  inst={inst}
                  isSelected={selectedInst === inst.id}
                  onClick={() => { setSelectedInst(inst.id); handleAddToSequence(inst.id); }}
                  hitCount={hitCounts[inst.id]}
                  setHitCount={(n) => setHitCounts((prev) => ({ ...prev, [inst.id]: n }))}
                  duration={durations[inst.id]}
                  setDuration={(n) => setDurations((prev) => ({ ...prev, [inst.id]: n }))}
                />
              ))}
            </section>
          </PaletteDropZone>

          {/* Ritim dizisi — dikey olarak ortalanmış, slotlar yatay-eğilimli dikdörtgen */}
          <section className="flex-1 flex flex-col justify-start pt-2 md:pt-4 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3 px-2">
              <h2 className="text-2xl md:text-3xl font-black text-slate-800">Ritim Dizisi</h2>
              <div className="flex items-center gap-3">
                <span className="px-3 py-1.5 rounded-2xl bg-white/70 border-4 border-white shadow text-sm font-black text-slate-700">
                  {bpm} BPM
                </span>
                <span className="text-slate-400 font-bold text-sm">
                  {sequence.filter((s) => s !== null).length} / {MAX_SLOTS}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2 md:gap-3 p-3 md:p-4 bg-white/60 backdrop-blur-md rounded-[2rem] border-4 border-white shadow-2xl">
              {sequence.map((slot, idx) => (
                <DroppableSlot
                  key={idx}
                  idx={idx}
                  slot={slot}
                  activeSlotIndex={activeSlotIndex}
                  onUpdateSlot={handleUpdateSlot}
                />
              ))}
            </div>

            {/* İlerleme çubuğu — başında çal/dur düğmesi, ritim dizisinden ayrılmış */}
            <div className="flex items-center gap-3 md:gap-4 pt-6 md:pt-10">
              <motion.button
                whileTap={{ scale: 0.92 }}
                disabled={!hasAnySlot}
                onClick={() => isPlaying ? handleStop() : handlePlay()}
                aria-label={isPlaying ? 'Durdur' : 'Başlat'}
                className={`shrink-0 flex items-center justify-center w-14 h-14 md:w-16 md:h-16 rounded-full border-4 border-white transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                  isPlaying
                    ? 'bg-rose-500 text-white shadow-[0_6px_0_rgb(190,18,60)] hover:translate-y-1 hover:shadow-[0_3px_0_rgb(190,18,60)] active:translate-y-2 active:shadow-none'
                    : 'bg-emerald-500 text-white shadow-[0_6px_0_rgb(4,120,87)] hover:translate-y-1 hover:shadow-[0_3px_0_rgb(4,120,87)] active:translate-y-2 active:shadow-none'
                }`}
              >
                {isPlaying
                  ? <Square className="w-6 h-6 md:w-7 md:h-7 fill-current" />
                  : <Play className="w-6 h-6 md:w-7 md:h-7 fill-current" />}
              </motion.button>

              {/* Belirgin ilerleme çubuğu — pasif kanal soluk, dolu kısım canlı gradyan */}
              <div className="flex-1 h-6 md:h-7 bg-white/15 rounded-full overflow-hidden border-4 border-white/70 shadow-lg">
                <motion.div
                  className="h-full bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500 rounded-full shadow-[inset_0_2px_8px_rgba(255,255,255,0.5)]"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.15, ease: 'linear' }}
                />
              </div>
            </div>
          </section>

          {/* Kontrol şeridi — daha aşağıda */}
          <section className="flex flex-wrap items-center justify-center gap-4 md:gap-6 pt-4 md:pt-8 pb-4">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={isPlaying ? undefined : (hasAnySlot ? handlePlay : () => handleAddToSequence())}
              className={`flex items-center gap-3 px-16 md:px-20 py-6 md:py-7 rounded-[2rem] font-black text-3xl md:text-5xl shadow-2xl transition-all ${
                isPlaying
                  ? 'bg-slate-400 text-white cursor-not-allowed'
                  : hasAnySlot
                    ? 'bg-amber-500 text-white shadow-[0_12px_0_rgb(180,83,9)] hover:translate-y-1 hover:shadow-[0_6px_0_rgb(180,83,9)] active:translate-y-2 active:shadow-none'
                    : 'bg-indigo-600 text-white shadow-[0_12px_0_rgb(49,46,129)] hover:translate-y-1 hover:shadow-[0_6px_0_rgb(49,46,129)] active:translate-y-2 active:shadow-none'
              }`}
            >
              {isPlaying ? (
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-9 md:h-10 bg-white/60 animate-bounce" />
                  <div className="w-2.5 h-9 md:h-10 bg-white/60 animate-bounce [animation-delay:0.1s]" />
                  <div className="w-2.5 h-9 md:h-10 bg-white/60 animate-bounce [animation-delay:0.2s]" />
                </div>
              ) : (
                <>
                  {hasAnySlot ? <Play className="w-10 h-10 md:w-12 md:h-12 fill-current" /> : null}
                  {hasAnySlot ? 'OYNAT' : 'EKLE'}
                </>
              )}
            </motion.button>

            {isPlaying && (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleStop}
                className="flex items-center gap-2 px-6 py-3 bg-rose-500 text-white rounded-2xl font-black text-lg shadow-[0_8px_0_rgb(190,18,60)] hover:translate-y-1 hover:shadow-[0_4px_0_rgb(190,18,60)] active:translate-y-2 active:shadow-none transition-all"
              >
                <Square className="w-5 h-5 fill-current" /> DUR
              </motion.button>
            )}

            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleClear}
              className="flex items-center gap-2 px-6 py-3 ml-6 md:ml-12 bg-sky-500 text-white rounded-2xl font-black text-lg shadow-[0_8px_0_rgb(3,105,161)] hover:translate-y-1 hover:shadow-[0_4px_0_rgb(3,105,161)] active:translate-y-2 active:shadow-none transition-all"
            >
              <RotateCcw className="w-5 h-5" /> TEMİZLE
            </motion.button>
          </section>
        </div>

        {/* SİL bölgesi — sol alt köşede sabit, sürükle-bırak için her zaman erişilebilir */}
        <TrashZone onClick={handleDeleteLast} />

        {/* HAZIR RİTİMLER — sağ alt köşede sabit, çöp kutusuyla simetrik */}
        <div className="fixed bottom-6 right-6 md:bottom-8 md:right-8 z-30 flex flex-col items-center gap-1.5">
          <span className="px-3 py-1 rounded-full bg-white/90 border-2 border-white text-slate-800 font-black text-xs md:text-sm shadow uppercase tracking-wide">
            Hazır Ritimler
          </span>
          <motion.button
            whileTap={{ scale: 0.94 }}
            onClick={() => setBrowserOpen(true)}
            aria-label="Hazır Ritimler"
            className="flex items-center justify-center w-32 h-32 md:w-40 md:h-40 rounded-3xl bg-indigo-600 text-white border-4 border-white shadow-[0_9px_0_rgb(49,46,129)] hover:translate-y-1 hover:shadow-[0_4px_0_rgb(49,46,129)] active:translate-y-2 active:shadow-none transition-all"
          >
            <Library className="w-14 h-14 md:w-20 md:h-20" />
          </motion.button>
        </div>

        <MelodyBrowser
          melodies={melodyList}
          readOnlyNames={PRESET_NAMES}
          isOpen={browserOpen}
          isConnected={isConnected}
          currentMelody={currentMelody}
          onClose={() => setBrowserOpen(false)}
          onRefresh={handleRefresh}
          onLoad={handleLoadMelody}
          onSave={handleSaveMelody}
          onDelete={handleDeleteMelody}
        />

        <SettingsPanel
          isOpen={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          status={connStatus}
          isReady={isReady}
          supported={SerialBridge.isSupported}
          message={connMessage}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          onCancelConnect={onCancelConnect}
          bpm={bpm}
          setBpm={setBpm}
        />
      </div>

      <DragOverlay>
        {activeId ? (
          <InstrumentCard inst={INSTRUMENTS.find((i) => i.id === activeId)!} isOverlay />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
