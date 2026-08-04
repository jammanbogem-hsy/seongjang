import {
  forwardRef,
  useId,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { Icon } from './Icon'
import { cx } from './utils'

interface FieldChromeProps {
  id: string
  label: ReactNode
  required?: boolean
  helpText?: ReactNode
  error?: ReactNode
  children: ReactNode
  className?: string
}

function FieldChrome({
  id,
  label,
  required,
  helpText,
  error,
  children,
  className,
}: FieldChromeProps) {
  return (
    <div className={cx('field', 'ui-field', Boolean(error) && 'ui-field--error', className)}>
      <label className="ui-field__label" htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true" className="ui-field__required"> *</span> : null}
      </label>
      {children}
      {error ? (
        <p className="field-error ui-field__message ui-field__message--error" id={`${id}-error`}>
          <Icon name="error" size="sm" />
          {error}
        </p>
      ) : helpText ? (
        <p className="field-help ui-field__message" id={`${id}-help`}>
          {helpText}
        </p>
      ) : null}
    </div>
  )
}

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: ReactNode
  helpText?: ReactNode
  error?: ReactNode
  leadingIcon?: string
  fieldClassName?: string
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  {
    id: providedId,
    label,
    helpText,
    error,
    leadingIcon,
    fieldClassName,
    className,
    required,
    'aria-describedby': describedBy,
    ...props
  },
  ref,
) {
  const generatedId = useId()
  const id = providedId ?? generatedId
  const messageId = error ? `${id}-error` : helpText ? `${id}-help` : undefined

  return (
    <FieldChrome
      className={fieldClassName}
      error={error}
      helpText={helpText}
      id={id}
      label={label}
      required={required}
    >
      <div className={cx('ui-field__control', leadingIcon && 'ui-field__control--with-icon')}>
        {leadingIcon ? <Icon name={leadingIcon} size="sm" /> : null}
        <input
          aria-describedby={[describedBy, messageId].filter(Boolean).join(' ') || undefined}
          aria-invalid={Boolean(error) || undefined}
          className={cx('ui-field__input', className)}
          id={id}
          ref={ref}
          required={required}
          {...props}
        />
      </div>
    </FieldChrome>
  )
})

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: ReactNode
  helpText?: ReactNode
  error?: ReactNode
  fieldClassName?: string
  showCount?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    id: providedId,
    label,
    helpText,
    error,
    fieldClassName,
    className,
    required,
    showCount = false,
    value,
    defaultValue,
    maxLength,
    onChange,
    'aria-describedby': describedBy,
    ...props
  },
  ref,
) {
  const generatedId = useId()
  const id = providedId ?? generatedId
  const messageId = error ? `${id}-error` : helpText ? `${id}-help` : undefined
  const [uncontrolledCount, setUncontrolledCount] = useState(() => String(defaultValue ?? '').length)
  const count = value === undefined ? uncontrolledCount : String(value).length

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    if (value === undefined) setUncontrolledCount(event.currentTarget.value.length)
    onChange?.(event)
  }

  return (
    <FieldChrome
      className={fieldClassName}
      error={error}
      helpText={helpText}
      id={id}
      label={label}
      required={required}
    >
      <textarea
        aria-describedby={[describedBy, messageId].filter(Boolean).join(' ') || undefined}
        aria-invalid={Boolean(error) || undefined}
        className={cx('ui-field__input', 'ui-field__textarea', className)}
        defaultValue={defaultValue}
        id={id}
        maxLength={maxLength}
        onChange={handleChange}
        ref={ref}
        required={required}
        value={value}
        {...props}
      />
      {showCount ? (
        <span aria-live="polite" className="ui-field__count">
          {count}{maxLength ? ` / ${maxLength}` : ''}
        </span>
      ) : null}
    </FieldChrome>
  )
})

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: ReactNode
  helpText?: ReactNode
  error?: ReactNode
  fieldClassName?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    id: providedId,
    label,
    helpText,
    error,
    fieldClassName,
    className,
    required,
    children,
    'aria-describedby': describedBy,
    ...props
  },
  ref,
) {
  const generatedId = useId()
  const id = providedId ?? generatedId
  const messageId = error ? `${id}-error` : helpText ? `${id}-help` : undefined

  return (
    <FieldChrome
      className={fieldClassName}
      error={error}
      helpText={helpText}
      id={id}
      label={label}
      required={required}
    >
      <div className="ui-field__control ui-field__control--select">
        <select
          aria-describedby={[describedBy, messageId].filter(Boolean).join(' ') || undefined}
          aria-invalid={Boolean(error) || undefined}
          className={cx('ui-field__input', 'ui-field__select', className)}
          id={id}
          ref={ref}
          required={required}
          {...props}
        >
          {children}
        </select>
        <Icon name="expand_more" size="sm" />
      </div>
    </FieldChrome>
  )
})
