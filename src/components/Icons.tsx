interface IconProps {
  size?: number
}

function Svg({ children, size = 20 }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const IconOpen = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Svg>
)

export const IconPaste = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <rect x="9" y="2" width="6" height="4" rx="1" />
  </Svg>
)

export const IconUndo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 6 4 10l4 4" />
    <path d="M4 10h11a5 5 0 0 1 0 10H9" />
  </Svg>
)

export const IconRedo = (p: IconProps) => (
  <Svg {...p}>
    <path d="m16 6 4 4-4 4" />
    <path d="M20 10H9a5 5 0 0 0 0 10h6" />
  </Svg>
)

export const IconFit = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9V4h5" />
    <path d="M15 4h5v5" />
    <path d="M20 15v5h-5" />
    <path d="M9 20H4v-5" />
  </Svg>
)

export const IconDownload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M4 20h16" />
  </Svg>
)

export const IconWand = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20 15 9" strokeWidth="2.4" />
    <path d="M17 3v4" />
    <path d="M15 5h4" />
    <path d="M20 10.5v3" />
    <path d="M18.5 12h3" />
  </Svg>
)

export const IconEraser = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8.5 19 3.9 14.4a2 2 0 0 1 0-2.8l8.2-8.2a2 2 0 0 1 2.8 0l5.2 5.2a2 2 0 0 1 0 2.8L13.5 19" />
    <path d="M8.5 19H21" />
    <path d="m8 8 8 8" />
  </Svg>
)

export const IconRestore = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 12a9 9 0 1 1-2.9-6.6" />
    <path d="M21 3v6h-6" />
  </Svg>
)

export const IconPan = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2v20" />
    <path d="M2 12h20" />
    <path d="m12 2-2.5 2.5M12 2l2.5 2.5" />
    <path d="m12 22-2.5-2.5M12 22l2.5-2.5" />
    <path d="M2 12l2.5-2.5M2 12l2.5 2.5" />
    <path d="m22 12-2.5-2.5M22 12l-2.5 2.5" />
  </Svg>
)

export const IconPickDrop = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.5 4.5a2.5 2.5 0 0 1 3.5 3.5l-7.5 7.5-4.2 1.2 1.2-4.2z" />
    <path d="m13 6 4.5 4.5" />
    <path d="M3 21h6" strokeWidth="2.2" />
  </Svg>
)

export const IconPickKeep = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.5 4.5a2.5 2.5 0 0 1 3.5 3.5l-7.5 7.5-4.2 1.2 1.2-4.2z" />
    <path d="m13 6 4.5 4.5" />
    <path d="M6 18v6M3 21h6" strokeWidth="2.2" />
  </Svg>
)
