type Props = {
  label: string
  value: string
  suffix?: string
  caption?: string
}

export function BigStat({ caption, label, suffix, value }: Props) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="text-3xl font-light leading-none tabular-nums">
          {value}
        </span>
        {suffix ? (
          <span className="text-base text-muted-foreground">{suffix}</span>
        ) : null}
      </p>
      {caption ? (
        <p className="mt-1 text-sm text-muted-foreground">{caption}</p>
      ) : null}
    </div>
  )
}
