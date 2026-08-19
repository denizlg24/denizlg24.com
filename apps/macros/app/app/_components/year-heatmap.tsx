import { format } from "date-fns"

type Props = {
  year: number
  getCellClass: (iso: string) => string
}

export function YearHeatmap({ getCellClass, year }: Props) {
  const months = Array.from({ length: 12 }, (_, monthIndex) => {
    const month = new Date(year, monthIndex, 1)
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
    return {
      label: format(month, "MMM"),
      days: Array.from({ length: daysInMonth }, (_, dayIndex) =>
        toIso(new Date(year, monthIndex, dayIndex + 1))
      ),
    }
  })

  return (
    <article className="min-w-full snap-center">
      <h2 className="mb-3 text-2xl font-bold">{year}</h2>
      <div className="rounded-2xl bg-muted/40 p-2">
        <div className="grid grid-cols-12 gap-1">
          {months.map((month) => (
            <div key={month.label} className="flex min-w-0 flex-col gap-2">
              <div className="grid grid-cols-4 gap-[3px]">
                {month.days.map((iso) => (
                  <span
                    key={iso}
                    className={`aspect-square ${getCellClass(iso)}`}
                  />
                ))}
                {Array.from({ length: 32 - month.days.length }, (_, index) => (
                  <span
                    key={`${month.label}-empty-${index}`}
                    className="aspect-square opacity-0"
                  />
                ))}
              </div>
              <span className="text-[10px] text-muted-foreground">
                {month.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </article>
  )
}

type CarouselProps = {
  years: number[]
  getCellClass: (iso: string) => string
}

export function YearHeatmapCarousel({ getCellClass, years }: CarouselProps) {
  if (years.length === 0) return null
  return (
    <section className="pb-8">
      <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-2">
        {years.map((year) => (
          <YearHeatmap key={year} year={year} getCellClass={getCellClass} />
        ))}
      </div>
    </section>
  )
}

function toIso(date: Date) {
  return format(date, "yyyy-MM-dd")
}
