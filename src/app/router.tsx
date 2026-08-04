import {
  Children,
  cloneElement,
  createContext,
  forwardRef,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react'

interface LocationState {
  pathname: string
  search: string
  hash: string
}

type NavigateOptions = { replace?: boolean }
type NavigateFunction = (to: string, options?: NavigateOptions) => void

interface RouterValue {
  location: LocationState
  navigate: NavigateFunction
}

const RouterContext = createContext<RouterValue | null>(null)
const ParamsContext = createContext<Record<string, string>>({})

function readLocation(): LocationState {
  return {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
  }
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(readLocation)

  useEffect(() => {
    const update = () => setLocation(readLocation())
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])

  const navigate = useCallback<NavigateFunction>((to, options) => {
    if (options?.replace) window.history.replaceState(null, '', to)
    else window.history.pushState(null, '', to)
    setLocation(readLocation())
  }, [])

  const value = useMemo(() => ({ location, navigate }), [location, navigate])
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

function useRouter(): RouterValue {
  const value = useContext(RouterContext)
  if (!value) throw new Error('Router hooks must be used within RouterProvider')
  return value
}

export function useNavigate(): NavigateFunction {
  return useRouter().navigate
}

export function useLocation(): LocationState {
  return useRouter().location
}

export function useParams<T extends Record<string, string | undefined> = Record<string, string>>() {
  return useContext(ParamsContext) as T
}

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string
  replace?: boolean
}

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { to, replace = false, onClick, target, children, ...props },
  ref,
) {
  const navigate = useNavigate()
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event)
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      target === '_blank'
    ) return
    event.preventDefault()
    navigate(to, { replace })
  }
  return <a href={to} onClick={handleClick} ref={ref} target={target} {...props}>{children}</a>
})

export interface NavLinkProps extends Omit<LinkProps, 'className'> {
  className?: string | ((state: { isActive: boolean }) => string)
  end?: boolean
}

export function NavLink({ className, end = false, to, ...props }: NavLinkProps) {
  const { pathname } = useLocation()
  const isActive = end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`)
  const resolvedClassName = typeof className === 'function' ? className({ isActive }) : className
  return <Link aria-current={isActive ? 'page' : undefined} className={resolvedClassName} to={to} {...props} />
}

export interface RouteProps {
  path: string
  element: ReactElement
}

export function Route(props: RouteProps) {
  void props
  return null
}

function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  if (pattern === '*') return {}
  const patternParts = pattern.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  const pathParts = pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  if (patternParts.length !== pathParts.length) return null
  const params: Record<string, string> = {}
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index]
    const actual = pathParts[index]
    if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(actual)
    else if (expected !== actual) return null
  }
  return params
}

export function Routes({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  for (const child of Children.toArray(children)) {
    if (!isValidElement<RouteProps>(child)) continue
    const params = matchPath(child.props.path, pathname)
    if (params) return <ParamsContext.Provider value={params}>{cloneElement(child.props.element)}</ParamsContext.Provider>
  }
  return null
}

export function Navigate({ to, replace = false }: { to: string; replace?: boolean }) {
  const navigate = useNavigate()
  useEffect(() => navigate(to, { replace }), [navigate, replace, to])
  return null
}
