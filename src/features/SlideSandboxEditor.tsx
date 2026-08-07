import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import type { Slide, SlideInputField, SlideInputFieldType } from '../domain/models'
import { MAX_SLIDE_INPUT_FIELDS } from '../domain/slideFields'
import { Button, Field, Icon, IconButton, Switch } from '../ui'

interface SlideSandboxEditorProps {
  fields: SlideInputField[]
  onChange: (fields: SlideInputField[]) => void
  responseCount?: number
  slide: Slide
}

interface DragState {
  field: SlideInputField
  kind: 'move' | 'resize'
  startX: number
  startY: number
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)))
}

function nextFieldId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `field-${crypto.randomUUID()}`
  }
  return `field-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function SlideSandboxEditor({ fields, onChange, responseCount = 0, slide }: SlideSandboxEditorProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(fields[0]?.id ?? null)
  const selected = useMemo(
    () => fields.find((field) => field.id === selectedId) ?? null,
    [fields, selectedId],
  )

  useEffect(() => {
    if (selectedId && !fields.some((field) => field.id === selectedId)) {
      setSelectedId(fields[0]?.id ?? null)
    }
  }, [fields, selectedId])

  useEffect(() => {
    function handlePointerMove(event: globalThis.PointerEvent) {
      const drag = dragRef.current
      const canvas = canvasRef.current
      if (!drag || !canvas) return
      const bounds = canvas.getBoundingClientRect()
      const deltaX = ((event.clientX - drag.startX) / bounds.width) * 100
      const deltaY = ((event.clientY - drag.startY) / bounds.height) * 100
      const next = drag.kind === 'move'
        ? {
            ...drag.field,
            x: clamp(drag.field.x + deltaX, 0, 100 - drag.field.width),
            y: clamp(drag.field.y + deltaY, 30, 100 - drag.field.height),
          }
        : {
            ...drag.field,
            width: clamp(drag.field.width + deltaX, 24, 100 - drag.field.x),
            height: clamp(drag.field.height + deltaY, 12, 100 - drag.field.y),
          }
      onChange(fields.map((field) => field.id === next.id ? next : field))
    }

    function handlePointerUp() {
      dragRef.current = null
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [fields, onChange])

  function addField(type: SlideInputFieldType) {
    if (fields.length >= MAX_SLIDE_INPUT_FIELDS) return
    const index = fields.length
    const baseLabel = type === 'number' ? '숫자 응답' : '텍스트 응답'
    let label = baseLabel
    let suffix = 2
    while (fields.some((field) => field.label === label)) label = `${baseLabel} ${suffix++}`
    const field: SlideInputField = {
      id: nextFieldId(),
      type,
      label,
      placeholder: type === 'number' ? '숫자를 입력하세요' : '내용을 입력하세요',
      required: true,
      x: index % 2 === 0 ? 6 : 54,
      y: 44 + Math.floor(index / 2) * 17,
      width: type === 'number' ? 34 : 40,
      height: 13,
    }
    onChange([...fields, field])
    setSelectedId(field.id)
  }

  function updateSelected(patch: Partial<SlideInputField>) {
    if (!selected) return
    onChange(fields.map((field) => field.id === selected.id ? { ...field, ...patch } : field))
  }

  function removeSelected() {
    if (!selected) return
    const next = fields.filter((field) => field.id !== selected.id)
    onChange(next)
    setSelectedId(next[0]?.id ?? null)
  }

  function startDrag(event: PointerEvent<HTMLElement>, field: SlideInputField, kind: DragState['kind']) {
    event.preventDefault()
    event.stopPropagation()
    setSelectedId(field.id)
    dragRef.current = { field, kind, startX: event.clientX, startY: event.clientY }
  }

  function handleFieldKeyDown(event: KeyboardEvent<HTMLDivElement>, field: SlideInputField) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
    if (event.shiftKey) {
      updateSelected(event.key === 'ArrowLeft' || event.key === 'ArrowRight'
        ? { width: clamp(field.width + direction, 24, 100 - field.x) }
        : { height: clamp(field.height + direction, 12, 100 - field.y) })
    } else {
      updateSelected(event.key === 'ArrowLeft' || event.key === 'ArrowRight'
        ? { x: clamp(field.x + direction, 0, 100 - field.width) }
        : { y: clamp(field.y + direction, 30, 100 - field.height) })
    }
  }

  return (
    <div className="slide-sandbox-editor">
      <div className="slide-sandbox-toolbar" role="toolbar" aria-label="입력 블록 도구">
        <div>
          <Button disabled={fields.length >= MAX_SLIDE_INPUT_FIELDS} leadingIcon="short_text" onClick={() => addField('text')} size="sm" variant="tonal">텍스트 입력</Button>
          <Button disabled={fields.length >= MAX_SLIDE_INPUT_FIELDS} leadingIcon="123" onClick={() => addField('number')} size="sm" variant="tonal">숫자 입력</Button>
        </div>
        <span><Icon name="drag_indicator" size="sm" /> 블록을 끌어 이동하고 모서리로 크기를 바꾸세요</span>
        <strong>{fields.length} / {MAX_SLIDE_INPUT_FIELDS}</strong>
      </div>

      {responseCount ? (
        <div className="slide-sandbox-preservation" role="status">
          <Icon name="inventory_2" size="sm" />
          <span><strong>기존 응답 {responseCount}개는 제출 당시 내용으로 별도 보존됩니다.</strong> 지금 수정한 입력 구조는 현재 참여자 화면에 실시간 반영됩니다.</span>
        </div>
      ) : null}

      <div className="slide-sandbox-layout">
        <div className="slide-sandbox-workspace">
          <div className="slide-sandbox-canvas" ref={canvasRef}>
            <span className="slide-sandbox-canvas__eyebrow">{slide.eyebrow}</span>
            <h3>{slide.title}</h3>
            <p>{slide.prompt}</p>
            {fields.map((field) => (
              <div
                aria-label={`${field.label} 입력 블록`}
                aria-selected={field.id === selectedId}
                className={`slide-sandbox-block${field.id === selectedId ? ' is-selected' : ''}`}
                key={field.id}
                onKeyDown={(event) => handleFieldKeyDown(event, field)}
                onPointerDown={(event) => startDrag(event, field, 'move')}
                role="option"
                style={{ left: `${field.x}%`, top: `${field.y}%`, width: `${field.width}%`, height: `${field.height}%` }}
                tabIndex={0}
              >
                <span>{field.label}{field.required ? ' *' : ''}</span>
                <div><Icon name={field.type === 'number' ? '123' : 'short_text'} size="sm" /> {field.placeholder}</div>
                <button
                  aria-label={`${field.label} 크기 조절`}
                  className="slide-sandbox-resize"
                  onPointerDown={(event) => startDrag(event, field, 'resize')}
                  type="button"
                />
              </div>
            ))}
            {!fields.length ? (
              <div className="slide-sandbox-empty">
                <Icon name="add_box" size="lg" />
                <strong>입력 블록을 추가하세요</strong>
                <span>상단 도구에서 텍스트 또는 숫자를 선택합니다.</span>
              </div>
            ) : null}
          </div>
        </div>

        <aside className="slide-sandbox-inspector" aria-label="선택한 입력 블록 설정">
          {selected ? (
            <>
              <header>
                <span className="material-symbols-rounded" aria-hidden="true">tune</span>
                <strong>입력 설정</strong>
                <IconButton icon="delete" label="선택한 입력 블록 삭제" onClick={removeSelected} />
              </header>
              <Field label="입력 이름" maxLength={80} onChange={(event) => updateSelected({ label: event.target.value })} value={selected.label} />
              <Field label="안내 문구" maxLength={100} onChange={(event) => updateSelected({ placeholder: event.target.value })} value={selected.placeholder} />
              <div className="slide-sandbox-range">
                <label htmlFor="sandbox-field-width">너비 <output>{selected.width}%</output></label>
                <input id="sandbox-field-width" max={100 - selected.x} min={24} onChange={(event) => updateSelected({ width: Number(event.target.value) })} type="range" value={selected.width} />
              </div>
              <div className="slide-sandbox-range">
                <label htmlFor="sandbox-field-height">높이 <output>{selected.height}%</output></label>
                <input id="sandbox-field-height" max={100 - selected.y} min={12} onChange={(event) => updateSelected({ height: Number(event.target.value) })} type="range" value={selected.height} />
              </div>
              <Switch checked={selected.required} label="필수 입력" onChange={(required) => updateSelected({ required })} />
              <p>방향키로 이동 · Shift + 방향키로 크기 조절</p>
            </>
          ) : (
            <div className="slide-sandbox-inspector__empty">
              <Icon name="touch_app" size="lg" />
              <strong>블록을 선택하세요</strong>
              <span>이름, 크기와 필수 여부를 설정할 수 있습니다.</span>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
